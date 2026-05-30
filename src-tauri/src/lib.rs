use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared state: the audio engine child process + its stdin handle
// ─────────────────────────────────────────────────────────────────────────────
struct EngineState {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    // (frontend_ready, buffered_events): engine events emitted before the
    // frontend attaches its listener are buffered here, then flushed once the
    // frontend calls `frontend_ready`. Prevents a startup race from dropping
    // the initial ready/devices/preset_list/chain events.
    outbox: Mutex<(bool, Vec<serde_json::Value>)>,
    // Set true when the app is intentionally quitting, so the reader thread
    // does NOT try to respawn a deliberately-killed engine.
    shutting_down: AtomicBool,
    // Count of consecutive *quick* crashes (engine died < 3s after launch).
    // Used to stop a runaway crash loop instead of respawning forever.
    crash_streak: AtomicU32,
    // When true, closing the window hides to tray; when false, it quits.
    close_to_tray: AtomicBool,
}

impl Default for EngineState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            stdin: Mutex::new(None),
            outbox: Mutex::new((false, Vec::new())),
            shutting_down: AtomicBool::new(false),
            crash_streak: AtomicU32::new(0),
            close_to_tray: AtomicBool::new(true),
        }
    }
}

const MAX_CRASH_STREAK: u32 = 5;

// ─────────────────────────────────────────────────────────────────────────────
// Locate the engine binary (resource dir when bundled, build dir in dev)
// ─────────────────────────────────────────────────────────────────────────────
fn find_engine(app: &AppHandle) -> Option<std::path::PathBuf> {
    // 1) Bundled resource
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("engine").join("VSTHostEngine.exe");
        if p.exists() {
            return Some(p);
        }
    }
    // 2) Dev build output, relative to the project root (cwd) or exe dir
    let candidates = [
        std::env::current_dir().ok().map(|d| {
            d.join("engine/build/VSTHostEngine_artefacts/Release/VSTHostEngine.exe")
        }),
        std::env::current_dir().ok().map(|d| {
            d.join("../engine/build/VSTHostEngine_artefacts/Release/VSTHostEngine.exe")
        }),
    ];
    for c in candidates.into_iter().flatten() {
        if c.exists() {
            return Some(c);
        }
    }
    None
}

// ─────────────────────────────────────────────────────────────────────────────
// Spawn the engine and pump its stdout → "engine-event" Tauri events
// ─────────────────────────────────────────────────────────────────────────────
fn spawn_engine(app: &AppHandle) {
    let engine_path = match find_engine(app) {
        Some(p) => p,
        None => {
            emit_or_buffer(app, serde_json::json!({
                "event": "engine_offline",
                "message": "Engine binary not found — build it with engine/build.bat"
            }));
            return;
        }
    };

    let mut cmd = Command::new(&engine_path);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    // Hide the engine's console window on Windows
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            emit_or_buffer(app, serde_json::json!({
                "event": "engine_offline",
                "message": format!("Failed to start engine: {e}")
            }));
            return;
        }
    };

    let stdout = child.stdout.take().expect("engine stdout");
    let stdin = child.stdin.take().expect("engine stdin");

    let state = app.state::<EngineState>();
    *state.stdin.lock().unwrap() = Some(stdin);
    *state.child.lock().unwrap() = Some(child);

    // Reader thread: forward each JSON line to the frontend (buffer until ready)
    let app_handle = app.clone();
    let started = std::time::Instant::now();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) if !l.trim().is_empty() => {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&l) {
                        emit_or_buffer(&app_handle, val);
                    }
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        // stdout closed → engine exited. Decide whether to respawn.
        let state = app_handle.state::<EngineState>();
        if state.shutting_down.load(Ordering::SeqCst) {
            return; // deliberate shutdown — stay down
        }

        // Crash-loop guard: only count it as a "quick crash" if the engine
        // died soon after launch. A long-lived engine resets the streak.
        let streak = if started.elapsed().as_secs() < 3 {
            state.crash_streak.fetch_add(1, Ordering::SeqCst) + 1
        } else {
            state.crash_streak.store(0, Ordering::SeqCst);
            1
        };

        if streak > MAX_CRASH_STREAK {
            emit_or_buffer(&app_handle, serde_json::json!({
                "event": "engine_offline",
                "message": "Audio engine keeps crashing on startup. \
                            Check your audio device/driver, then restart the app."
            }));
            return;
        }

        // Check crash-attribution file written by the engine before each load.
        let attr_msg = {
            let attr = std::env::var("APPDATA").ok()
                .map(std::path::PathBuf::from)
                .map(|d| d.join("VSTHost").join("last_load.txt"));
            attr.and_then(|p| std::fs::read_to_string(p).ok())
                .filter(|s| !s.trim().is_empty())
                .map(|s| format!(" (possibly while loading: {})", s.trim()))
                .unwrap_or_default()
        };

        emit_or_buffer(&app_handle, serde_json::json!({
            "event": "engine_offline",
            "message": format!("Audio engine stopped{} — restarting…", attr_msg)
        }));

        // Brief backoff so we don't hammer a failing device, then respawn.
        std::thread::sleep(std::time::Duration::from_millis(800));
        if !state.shutting_down.load(Ordering::SeqCst) {
            spawn_engine(&app_handle);
        }
    });
}

// Emit an engine event live if the frontend is ready, otherwise buffer it.
fn emit_or_buffer(app: &AppHandle, val: serde_json::Value) {
    let state = app.state::<EngineState>();
    let mut guard = state.outbox.lock().unwrap();
    if guard.0 {
        drop(guard);
        let _ = app.emit("engine-event", val);
    } else {
        guard.1.push(val);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────
#[tauri::command]
fn engine_command(state: tauri::State<EngineState>, cmd: serde_json::Value) -> Result<(), String> {
    let mut guard = state.stdin.lock().map_err(|e| e.to_string())?;
    if let Some(stdin) = guard.as_mut() {
        let line = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
        stdin.write_all(line.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Engine not running".into())
    }
}

// The frontend mirrors its "Close to tray" setting here so the native window
// close handler can decide whether to hide to tray or actually quit.
#[tauri::command]
fn set_close_to_tray(state: tauri::State<EngineState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
fn engine_running(state: tauri::State<EngineState>) -> bool {
    state.stdin.lock().map(|g| g.is_some()).unwrap_or(false)
}

// The frontend polls this to drain buffered engine events as plain return
// values (no event-channel race). Once it has received the startup burst it
// calls with go_live=true, after which events stream live via the listener.
#[tauri::command]
fn poll_events(state: tauri::State<EngineState>, go_live: bool) -> Vec<serde_json::Value> {
    let mut guard = state.outbox.lock().unwrap();
    if go_live { guard.0 = true; }
    guard.1.drain(..).collect()
}

// ── Preset storage (Rust-managed, in the Tauri config dir which is reliably
// accessible to the app process — unlike the engine's own AppData lookup) ────
fn presets_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_config_dir().ok()?.join("presets");
    let _ = std::fs::create_dir_all(&dir);
    Some(dir)
}

fn sanitize(name: &str) -> String {
    name.chars().map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c }).collect()
}

#[tauri::command]
fn list_presets(app: AppHandle) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    if let Some(dir) = presets_dir(&app) {
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for entry in rd.flatten() {
                let p = entry.path();
                if p.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
                if let Ok(text) = std::fs::read_to_string(&p) {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                        let name = v.get("name").and_then(|x| x.as_str())
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| p.file_stem().unwrap().to_string_lossy().to_string());
                        out.push(serde_json::json!({ "name": name }));
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
    out
}

#[tauri::command]
fn save_preset(app: AppHandle, name: String, data: serde_json::Value) -> Result<(), String> {
    let dir = presets_dir(&app).ok_or("no presets dir")?;
    let path = dir.join(format!("{}.json", sanitize(&name)));
    std::fs::write(path, serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn load_preset(app: AppHandle, name: String) -> Option<serde_json::Value> {
    let dir = presets_dir(&app)?;
    let text = std::fs::read_to_string(dir.join(format!("{}.json", sanitize(&name)))).ok()?;
    serde_json::from_str(&text).ok()
}

#[tauri::command]
fn delete_preset(app: AppHandle, name: String) {
    if let Some(dir) = presets_dir(&app) {
        let _ = std::fs::remove_file(dir.join(format!("{}.json", sanitize(&name))));
    }
}

#[tauri::command]
fn rename_preset(app: AppHandle, old_name: String, new_name: String) -> Result<(), String> {
    let dir = presets_dir(&app).ok_or("no presets dir")?;
    let old_path = dir.join(format!("{}.json", sanitize(&old_name)));
    let new_path = dir.join(format!("{}.json", sanitize(&new_name)));
    if !old_path.exists() { return Err(format!("Preset '{}' not found", old_name)); }
    if new_path.exists()  { return Err(format!("A preset named '{}' already exists", new_name)); }
    // Update the "name" field inside the JSON too
    let text = std::fs::read_to_string(&old_path).map_err(|e| e.to_string())?;
    let mut data: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if let Some(obj) = data.as_object_mut() {
        obj.insert("name".into(), serde_json::Value::String(new_name.clone()));
    }
    std::fs::write(&new_path, serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::remove_file(&old_path).map_err(|e| e.to_string())
}

fn state_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("state.json"))
}

#[tauri::command]
fn load_state(app: AppHandle) -> Option<serde_json::Value> {
    let path = state_file(&app)?;
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

// Enable/disable launch-at-login via the HKCU Run key (no extra crates — uses reg.exe)
#[tauri::command]
fn set_autostart(enabled: bool, minimized: bool) -> Result<(), String> {
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe.to_string_lossy().to_string();

    let mut cmd = std::process::Command::new("reg");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    if enabled {
        let value = if minimized { format!("\"{exe}\" --minimized") } else { format!("\"{exe}\"") };
        cmd.args(["add", key, "/v", "VSTHost", "/t", "REG_SZ", "/d", &value, "/f"]);
    } else {
        cmd.args(["delete", key, "/v", "VSTHost", "/f"]);
    }
    cmd.status().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_state(app: AppHandle, state: serde_json::Value) -> Result<(), String> {
    let path = state_file(&app).ok_or("No config dir")?;
    let text = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// App entry
// ─────────────────────────────────────────────────────────────────────────────
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(EngineState::default())
        .invoke_handler(tauri::generate_handler![
            engine_command,
            engine_running,
            set_close_to_tray,
            poll_events,
            list_presets,
            save_preset,
            load_preset,
            delete_preset,
            rename_preset,
            set_autostart,
            load_state,
            save_state
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // ── System tray ──────────────────────────────────────────────────
            let show = MenuItem::with_id(app, "show", "Show VSTHost", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("VSTHost")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        app.state::<EngineState>().shutting_down.store(true, Ordering::SeqCst);
                        // Best-effort: kill the engine child so it doesn't linger
                        if let Some(mut c) = app.state::<EngineState>().child.lock().unwrap().take() {
                            let _ = c.kill();
                        }
                        app.exit(0)
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick { .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // ── Show window unless launched with --minimized ─────────────────
            let minimized = std::env::args().any(|a| a == "--minimized");
            if !minimized {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                }
            }

            // ── Launch the audio engine ──────────────────────────────────────
            spawn_engine(&handle);

            Ok(())
        })
        .on_window_event(|window, event| {
            // Close to tray instead of quitting — but only if the user's
            // "Close to tray" setting is on. Otherwise actually quit.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<EngineState>();
                if state.close_to_tray.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    state.shutting_down.store(true, Ordering::SeqCst);
                    if let Some(mut c) = state.child.lock().unwrap().take() {
                        let _ = c.kill();
                    }
                    // Don't prevent close → the window closes and the app exits.
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running VSTHost");
}
