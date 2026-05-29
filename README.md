# VSTHost
<img width="1100" height="780" alt="image" src="https://github.com/user-attachments/assets/013bfff2-47ea-4902-983e-50475a893911" />

A lightweight, **VST3-only microphone-processing host for Windows**. It puts a single live mic through a chain of VST3 plugins — EQ, compressor, gate, de-esser, saturation, whatever you like — and sends the processed signal to your monitors and/or straight into apps like **Discord, Zoom, OBS and Teams**.

Think of it as a tiny, focused mixing channel that sits between your microphone and everything else on your PC.

> 🤖 **Built entirely with [Claude Code](https://claude.com/claude-code).** The whole thing — C++/JUCE audio engine, Tauri/React UI, and the build tooling — was designed and written by Claude Code in collaboration with the repo owner. Credit for the code belongs to that work, not to me.

---

## Why this exists

Most ways to "improve your mic before Discord" are either heavy or awkward:

- **Full DAWs** (Reaper, Ableton, etc.) can host plugins on a live input, but they're huge, slow to open, and overkill for "just clean up my voice."
- **All-in-one tools** (Voicemeeter + plugin hosts, vendor apps) tend to be either fiddly to route or locked to one brand.
- **Inspiration:** [LightHost](https://github.com/rolandoislas/LightHost) proved a minimal plugin host is possible — but it's bare-bones and unmaintained.

VSTHost aims for the middle: **a single-purpose, polished, low-latency host** that does one thing well — process one mic channel — and gets out of the way. It opens fast, lives in the system tray, remembers your setup, and uses ASIO for genuinely low latency.

---

## Features

- **One mic → one plugin chain.** Drag plugins in, reorder them, bypass or disable any slot.
- **VST3 plugin support** with a real plugin browser, search, category filter, and favorites.
- **Native plugin editor windows** — open each plugin's own GUI in its own window, just like a DAW.
- **ASIO & WASAPI backends.** Pick ASIO for lowest latency; choose your input device, output device, and channel pair.
- **Virtual-output send.** Route the processed mic to a second device (e.g. a virtual audio cable) so Discord/Zoom/OBS hear the polished signal while you still monitor locally.
- **Presets** with full plugin-state fidelity (every knob, curve, and internal setting), quick-switchable with number keys `1`–`9`.
- **Metering:** input/output meters with a dB scale and latching clip indicator, plus a per-plugin level meter and a CPU readout.
- **Master Mute** (kills monitor *and* send) and a separate **Monitor toggle** (mutes only what *you* hear, apps keep receiving you).
- **Bypass All** to A/B your processed vs. raw signal instantly (`Space`).
- **Resilient engine:** the audio engine runs as a separate process and **auto-restarts if it crashes**, re-applying your routing and chain. A scan **blacklist** skips any plugin that crashed during scanning so one bad plugin can't break the app.
- **Stays out of your way:** dark theme, **start-with-Windows**, **start-minimized**, and **minimize-to-tray** options. Your settings, devices, scanned plugins, and last preset are remembered between launches.

---

## Install

Grab the latest build from the [**Releases**](https://github.com/KlayaR/VSTHost/releases/latest) page:

- **Installer (recommended):** download `VSTHost_<version>_x64-setup.exe` and run it. Adds a Start-menu shortcut.
- **Portable:** download `VSTHost-<version>-portable.zip`, extract it anywhere, and run `vsthost.exe`. Keep the `engine` folder next to the exe — the app launches the audio engine from there.

### Requirements

- **Windows 10/11 (x64)**
- **Microsoft Edge WebView2 runtime** — already installed on virtually all Windows 10/11 machines (ships with Windows/Edge). If the window opens blank, install it free from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/).
- **VST3 plugins** (this host is VST3-only).
- For lowest latency: an **ASIO driver** for your audio interface. WASAPI works too.

Settings and presets are stored per-user under `%APPDATA%\com.vsthost.app` — not in the app folder — so the portable build stays self-contained.

---

## How to use

1. **Pick your audio device.** In the **Routing** panel, choose your driver type (ASIO for lowest latency), then your input device/channel (your mic) and output device/channel (your monitors/headphones).
2. **Scan for plugins.** Go to **Settings → Plugin Scan Paths**. The default VST3 location is included; add folders if needed, then click **Scan for Plugins**.
3. **Build your chain.** Drag plugins from the browser into the rack. Reorder by dragging; click a slot's editor button to open the plugin's own GUI and dial it in.
4. **Monitor and adjust.** Watch the input/output meters and per-plugin levels; use **Bypass All** (`Space`) to compare against your raw mic.
5. **Save a preset.** Click **Save** (`Ctrl+S`). Recall presets later, or switch between them with number keys `1`–`9`.

### Sending your processed mic into Discord / Zoom / OBS

If you don't have an audio interface with internal routing (like an RME with TotalMix):

1. Install a **virtual audio cable** (e.g. [VB-CABLE](https://vb-audio.com/Cable/)).
2. In **Routing → Virtual Output**, select that cable.
3. In Discord/Zoom/OBS, set your **microphone/input** to the same virtual cable.

Now those apps receive your fully-processed mic. Use the **Monitor** toggle if you want to stop hearing yourself locally while the apps keep getting your voice; use **Mute** to cut everything.

---

## How it works

VSTHost is two pieces that talk over a simple JSON protocol:

- **Audio engine** — a native **C++ app built on [JUCE](https://juce.com/)** that owns the audio device (ASIO/WASAPI), hosts the VST3 plugins, and does all real-time processing. It runs as a **separate process** so a misbehaving plugin can't take down the UI — and the shell restarts it automatically if it dies.
- **UI** — a **[Tauri](https://tauri.app/)** app (Rust shell + a React/TypeScript front-end rendered in the system WebView2). Tauri keeps the download tiny and memory use low compared to a bundled-browser approach.

This split is why the app is small and responsive while still doing real, low-latency audio.

---

## Building from source

You need: **Node.js**, **Rust** (stable), **CMake**, and **Visual Studio Build Tools** with the *Desktop development with C++* workload. JUCE and the ASIO SDK are fetched automatically by CMake.

```bash
# 1. Install front-end deps
npm install

# 2. Build the C++ audio engine (downloads JUCE on first run; takes a while)
cd engine
build.bat
cd ..

# 3. Run in dev mode
npm run tauri dev

# …or produce an installer + portable exe
npm run tauri build
```

The built engine binary lands in `engine/build/VSTHostEngine_artefacts/Release/` and is bundled next to the app.

---

## License & credits

- Inspired by [LightHost](https://github.com/rolandoislas/LightHost).
- Audio engine powered by [JUCE](https://juce.com/); ASIO is a trademark of Steinberg.
- Desktop shell by [Tauri](https://tauri.app/).
- **Designed and implemented with [Claude Code](https://claude.com/claude-code).**
