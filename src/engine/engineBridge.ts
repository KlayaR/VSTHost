/**
 * engineBridge.ts
 *
 * Bridges the real C++ audio engine (via the Tauri Rust backend) to the
 * Zustand store. The Rust side spawns the engine, forwards its stdout JSON as
 * "engine-event" events, and accepts commands through the `engine_command`
 * invoke. In a plain browser (no Tauri) it silently stays in offline mode.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useStore } from '../store/useStore'
import { restoreEngineState } from './persistence'

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// True once we've seen the engine's first "ready". A subsequent "ready" means
// the engine was restarted (crash recovery) and we must re-push our state.
let engineHasStarted = false

export function sendEngineCommand(cmd: object) {
  if (!inTauri()) return
  invoke('engine_command', { cmd }).catch((e) => console.error('[engine_command]', e))
}

// ── Event handler ─────────────────────────────────────────────────────────────
function handleEngineEvent(event: unknown) {
  if (!event || typeof event !== 'object') return
  const e = event as Record<string, unknown>
  const store = useStore.getState()

  // Receiving any event proves the engine is alive.
  if (e['event'] !== 'engine_offline' && !store.engineConnected) {
    store.setEngineConnected(true)
  }

  switch (e['event']) {
    case 'ready': {
      store.setEngineConnected(true)
      if (engineHasStarted) {
        // This is a RESTART (engine crashed and Rust respawned it). The fresh
        // engine is at defaults, so push our current routing + chain + gains
        // back into it, then refresh the device list.
        store.reapplyToEngine()
        sendEngineCommand({ cmd: 'get_devices' })
        break
      }
      engineHasStarted = true
      store.setLoadingState({ loadingPhase: 'Audio engine ready', loadingProgress: -1 })
      store.setRoutingFromEngine({
        sampleRate:     e['sampleRate'] as number | undefined,
        bufferSize:     e['bufferSize'] as number | undefined,
        backend:        e['backend'] as string | undefined,
        inputDeviceId:  e['inputDevice'] as string | undefined,
        outputDeviceId: e['outputDevice'] as string | undefined,
      })
      sendEngineCommand({ cmd: 'get_devices' })
      sendEngineCommand({ cmd: 'get_chain' })
      store.refreshPresets()        // presets come from Rust storage
      // Re-apply the user's saved backend/device choice
      restoreEngineState()
      break
    }

    case 'engine_offline': {
      store.setEngineConnected(false)
      if (store.appLoading) store.finishLoading()  // don't trap the user behind the splash
      break
    }

    case 'devices': {
      const inputs   = (e['inputs']  as { name: string }[]) ?? []
      const outputs  = (e['outputs'] as { name: string }[]) ?? []
      const types    = (e['types']   as { name: string }[]) ?? []
      const inCh     = (e['inputChannels']  as string[]) ?? []
      const outCh    = (e['outputChannels'] as string[]) ?? []
      store.setRealDevices(inputs.map(d => d.name), outputs.map(d => d.name))
      store.setRealBackends(types.map(t => t.name))
      store.setRealChannels(inCh, outCh)
      store.setRealVirtualOutputs((e['virtualOutputs'] as string[]) ?? [])
      store.setRoutingFromEngine({
        sampleRate:      e['sampleRate'] as number | undefined,
        bufferSize:      e['bufferSize'] as number | undefined,
        backend:         e['backend'] as string | undefined,
        inputDeviceId:   e['inputDevice'] as string | undefined,
        outputDeviceId:  e['outputDevice'] as string | undefined,
        inputChannel:    e['inputChannel'] as number | undefined,
        outputChannel:   e['outputChannel'] as number | undefined,
        virtualOutputId: e['virtualOutput'] as string | undefined,
      })
      break
    }

    case 'levels': {
      store.setLevels(
        (e['input'] as number) ?? 0,
        (e['output'] as number) ?? 0,
        (e['cpu'] as number) ?? 0,
        (e['slots'] as number[]) ?? [],
      )
      break
    }

    case 'chain': {
      store.setChainFromEngine((e['plugins'] as unknown[]) ?? [])
      store.setBypassAllState((e['bypassAll'] as boolean) ?? false)
      break
    }

    case 'load_progress': {
      const idx   = (e['index'] as number) ?? 0
      const total = (e['total'] as number) ?? 1
      // Prefer the friendly plugin name from the optimistic slots we rendered.
      const slot  = store.slots[idx - 1]
      const name  = slot?.plugin?.name && slot.plugin.name !== 'Loading…'
        ? slot.plugin.name
        : String(e['name'] ?? '').split(/[\\/]/).pop() ?? ''
      store.setLoadingState({
        loadingPhase:    'Loading plugins…',
        loadingDetail:   `${idx} / ${total}  ·  ${name}`,
        loadingProgress: total > 0 ? idx / total : -1,
      })
      break
    }

    case 'load_done': {
      store.finishLoading()
      break
    }

    case 'plugins_scanned': {
      store.setScannedPlugins((e['plugins'] as unknown[]) ?? [])
      store.setPluginBlacklist((e['blacklist'] as string[]) ?? [])
      store.setScanFinished()
      break
    }

    case 'scan_progress': {
      store.setScanProgress((e['plugin'] as string) ?? '', (e['progress'] as number) ?? 0)
      break
    }

    case 'preset_saved':
    case 'preset_list':
      // Presets are managed by Rust now; ignore the engine's (empty) list.
      break

    case 'preset_loaded': {
      store.setChainFromEngine((e['chain'] as unknown[]) ?? [])
      store.setInputGain((e['inputGain'] as number) ?? 0)
      store.setOutputGain((e['outputGain'] as number) ?? 0)
      break
    }

    case 'modified':
      // A hosted plugin's parameters changed (e.g. via its editor window)
      useStore.setState({ presetModified: true })
      break

    case 'editor_opened':
    case 'editor_closed':
      // Informational; UI does not need to react.
      break

    case 'warning': {
      const msg = String(e['message'] ?? '')
      console.warn('[Engine warning]', msg)
      store.setEngineWarning(msg)
      break
    }

    case 'error': {
      const msg = String(e['message'] ?? 'Unknown engine error')
      console.error('[Engine]', msg)
      store.setEngineError(msg)
      break
    }
  }
}

// ── Init (call once from App.tsx) ─────────────────────────────────────────────
let unlisten: UnlistenFn | null = null

export async function initEngineBridge() {
  if (!inTauri()) {
    // Browser preview → no engine, don't sit behind the splash forever.
    useStore.getState().finishLoading()
    return
  }

  useStore.getState().setLoadingState({ appLoading: true, loadingPhase: 'Starting audio engine…', loadingProgress: -1 })
  // Watchdog: never trap the user behind the loading screen if something stalls.
  setTimeout(() => { if (useStore.getState().appLoading) useStore.getState().finishLoading() }, 60000)

  unlisten = await listen('engine-event', (evt) => handleEngineEvent(evt.payload))

  // The engine's startup burst (ready/devices/chain/preset_list) is buffered on
  // the Rust side. Poll for it as return values (no listener race) until the
  // engine has come up, THEN switch to live streaming for levels.
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  let gotReady = false
  for (let i = 0; i < 80 && !gotReady; i++) {        // up to ~8s for ASIO init
    try {
      const evs = await invoke<Record<string, unknown>[]>('poll_events', { goLive: false })
      for (const ev of evs) {
        handleEngineEvent(ev)
        if (ev['event'] === 'ready') gotReady = true
      }
    } catch { /* ignore */ }
    if (!gotReady) await sleep(100)
  }
  // Switch to live mode and drain anything that arrived in between.
  try {
    const rest = await invoke<Record<string, unknown>[]>('poll_events', { goLive: true })
    rest.forEach(handleEngineEvent)
  } catch { /* ignore */ }
}

export function destroyEngineBridge() {
  unlisten?.()
  unlisten = null
}
