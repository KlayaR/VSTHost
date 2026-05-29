/**
 * persistence.ts
 *
 * Saves/restores app state to a JSON file via the Tauri Rust backend
 * (load_state / save_state commands). Persists everything the user would
 * expect to survive a restart: theme, behavior settings, scanned plugins,
 * routing (backend/devices/SR/buffer), scan paths and the active preset.
 */

import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../store/useStore'

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function snapshot() {
  const s = useStore.getState()
  return {
    theme:            s.theme,
    startWithWindows: s.startWithWindows,
    startMinimized:   s.startMinimized,
    closeToTray:      s.closeToTray,
    autoBypass:       s.autoBypass,
    scanPaths:        s.scanPaths,
    availablePlugins: s.availablePlugins,
    routing:          s.routing,
    activePresetId:   s.activePresetId,
  }
}

// Routing captured from the persisted file, applied once the engine is ready
// (kept separate so the engine's own "ready" state can't clobber the user's
// saved choice before we re-apply it).
let savedRouting: Record<string, unknown> | null = null

let timer: ReturnType<typeof setTimeout> | null = null

/** Tell the Rust window-close handler whether to hide-to-tray or quit. */
export function syncCloseToTray(enabled: boolean) {
  if (!inTauri()) return
  invoke('set_close_to_tray', { enabled }).catch(() => {})
}

/** Debounced save — call after any persistable change. */
export function schedulePersist() {
  if (!inTauri()) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    invoke('save_state', { state: snapshot() }).catch(() => {})
  }, 400)
}

/** Load persisted state once at startup (before the engine connects). */
export async function loadPersisted() {
  if (!inTauri()) return
  try {
    const data = await invoke<Record<string, unknown> | null>('load_state')
    if (data) {
      savedRouting = (data['routing'] as Record<string, unknown>) ?? null
      useStore.getState().hydrate(data)
      syncCloseToTray(useStore.getState().closeToTray)
    }
  } catch { /* first run — nothing saved yet */ }
}

/**
 * After the engine reports "ready", re-apply the persisted backend/device so
 * the audio path matches what the user left. (Sample rate & buffer follow the
 * device.) The active preset is restored separately, once its list arrives.
 */
export function restoreEngineState() {
  if (!savedRouting) return
  const { setRouting, routing } = useStore.getState()
  const r = savedRouting
  // The engine already reported its current backend/device in the "ready"
  // event (mirrored into `routing`). Only re-apply settings that actually
  // DIFFER — each setAudioDeviceSetup is a full device restart on ASIO (seconds),
  // so skipping redundant ones is the difference between an instant and a
  // multi-second startup.
  // Order matters: backend & device before channels (selecting a device resets
  // the channel selection).
  if (r['backend']        && r['backend']        !== routing.backend)        setRouting({ backend: String(r['backend']) })
  if (r['inputDeviceId']  && r['inputDeviceId']  !== routing.inputDeviceId)  setRouting({ inputDeviceId: String(r['inputDeviceId']) })
  if (r['outputDeviceId'] && r['outputDeviceId'] !== routing.outputDeviceId) setRouting({ outputDeviceId: String(r['outputDeviceId']) })
  if (typeof r['inputChannel'] === 'number' && r['inputChannel'] >= 0 && r['inputChannel'] !== routing.inputChannel)
    setRouting({ inputChannel: r['inputChannel'] as number })
  if (typeof r['outputChannel'] === 'number' && r['outputChannel'] >= 0 && r['outputChannel'] !== routing.outputChannel)
    setRouting({ outputChannel: r['outputChannel'] as number })
  if (r['virtualOutputId'] && r['virtualOutputId'] !== routing.virtualOutputId)
    setRouting({ virtualOutputId: String(r['virtualOutputId']) })
  savedRouting = null  // only restore once
}
