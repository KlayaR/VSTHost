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
    theme:             s.theme,
    startWithWindows:  s.startWithWindows,
    startMinimized:    s.startMinimized,
    closeToTray:       s.closeToTray,
    autoBypass:        s.autoBypass,
    scanPaths:         s.scanPaths,
    availablePlugins:  s.availablePlugins,
    favoriteIds:       Array.from(s.favoriteIds),   // Set → array for JSON
    routing:           s.routing,
    activePresetId:    s.activePresetId,
    limiterEnabled:    s.limiterEnabled,
    limiterThreshold:  s.limiterThreshold,
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
  // Backend & device: the engine reported its CURRENT (default-opened) values
  // in the "ready" event, mirrored into `routing`. Only re-apply when they
  // differ — each setAudioDeviceSetup is a full device restart on ASIO (seconds),
  // so skipping redundant ones keeps startup fast.
  // Order matters: backend & device before channels (selecting a device resets
  // the channel selection).
  if (r['backend']        && r['backend']        !== routing.backend)        setRouting({ backend: String(r['backend']) })
  if (r['inputDeviceId']  && r['inputDeviceId']  !== routing.inputDeviceId)  setRouting({ inputDeviceId: String(r['inputDeviceId']) })
  if (r['outputDeviceId'] && r['outputDeviceId'] !== routing.outputDeviceId) setRouting({ outputDeviceId: String(r['outputDeviceId']) })

  // Channels & virtual output are NOT reported in the "ready" event, so we
  // can't compare against the engine's actual state — always re-apply them, or
  // they'd never reach the engine (it opens with default channels / no send).
  if (typeof r['inputChannel'] === 'number' && r['inputChannel'] >= 0)
    setRouting({ inputChannel: r['inputChannel'] as number })
  if (typeof r['outputChannel'] === 'number' && r['outputChannel'] >= 0)
    setRouting({ outputChannel: r['outputChannel'] as number })
  if (r['virtualOutputId'])
    setRouting({ virtualOutputId: String(r['virtualOutputId']) })

  // Limiter settings are in the snapshot too — push them to the engine
  const { limiterEnabled, limiterThreshold, setLimiterEnabled, setLimiterThreshold } = useStore.getState()
  setLimiterEnabled(limiterEnabled)
  setLimiterThreshold(limiterThreshold)

  savedRouting = null  // only restore once
}
