import { create } from 'zustand'
import type { NavSection, Preset, PluginSlot, RoutingSettings, Theme, Plugin } from '../types'
import { DEFAULT_ROUTING } from '../data/mockData'
import { sendEngineCommand } from '../engine/engineBridge'
import { schedulePersist } from '../engine/persistence'
import { listPresetData, savePresetData, loadPresetData, deletePresetData, serializeChain } from '../engine/presets'

// ── Helper: map raw engine chain slot → UI PluginSlot ─────────────────────────
function rawToSlot(raw: Record<string, unknown>): PluginSlot {
  const params = ((raw['parameters'] as Record<string, unknown>[]) ?? []).map(p => ({
    id:      String(p['index']),
    name:    String(p['name']),
    value:   Number(p['value']),
    min:     0,
    max:     1,
    default: Number(p['value']),
    unit:    String(p['label'] ?? ''),
  }))

  return {
    id:        String(raw['uid'] ?? `slot-${Math.random()}`),
    enabled:   raw['enabled'] !== false,
    bypassed:  raw['bypassed'] === true,
    expanded:  false,
    state:     raw['state'] ? String(raw['state']) : undefined,
    plugin: {
      id:           String(raw['identifier'] ?? raw['file']),
      file:         String(raw['file'] ?? ''),
      uid:          String(raw['identifier'] ?? ''),
      name:         String(raw['name']),
      manufacturer: String(raw['manufacturer'] ?? ''),
      format:       'VST3',
      category:     String(raw['category'] ?? ''),
      latency:      Number(raw['latency'] ?? 0),
      favorite:     false,
      parameters:   params,
    },
  }
}

interface AppState {
  // Navigation
  activeSection: NavSection
  setActiveSection: (s: NavSection) => void

  // Theme
  theme: Theme
  toggleTheme: () => void

  // Behavior settings (persisted)
  startWithWindows: boolean
  startMinimized: boolean
  closeToTray: boolean
  autoBypass: boolean
  scanPaths: string[]
  setSetting: (key: 'startWithWindows' | 'startMinimized' | 'closeToTray' | 'autoBypass', v: boolean) => void
  setScanPaths: (paths: string[]) => void

  // Engine connection
  engineConnected: boolean
  setEngineConnected: (v: boolean) => void
  engineScanProgress: { plugin: string; progress: number } | null
  setScanProgress: (plugin: string, progress: number) => void
  setScanFinished: () => void
  engineError: string | null
  setEngineError: (msg: string | null) => void

  // Rack
  slots: PluginSlot[]
  inputGain: number
  outputGain: number
  bypassAll: boolean
  inputLevel: number
  outputLevel: number
  presetModified: boolean

  setInputGain:      (v: number) => void
  setOutputGain:     (v: number) => void
  toggleBypassAll:   () => void
  setBypassAllState: (v: boolean) => void

  toggleSlotEnabled:  (id: string) => void
  toggleSlotBypassed: (id: string) => void
  toggleSlotExpanded: (id: string) => void
  removeSlot:         (id: string) => void
  addPluginToSlot:    (plugin: Plugin, index?: number) => void
  reorderSlots:       (from: number, to: number) => void
  updateParam:        (slotId: string, paramId: string, value: number) => void
  openEditor:         (id: string) => void
  setLevels:          (input: number, output: number) => void
  setChainFromEngine: (raw: unknown[]) => void
  pendingSaveName:    string | null

  // Presets
  presets: Preset[]
  activePresetId: string | null
  loadPreset:      (id: string) => void
  savePreset:      (name: string, description: string) => void
  updatePreset:    () => void
  deletePreset:    (id: string) => void
  duplicatePreset: (id: string) => void
  refreshPresets:  () => void
  setEnginePresets:() => void

  // Plugin catalog
  availablePlugins: Plugin[]
  toggleFavorite:   (pluginId: string) => void
  setScannedPlugins:(raw: unknown[]) => void

  // Routing
  routing: RoutingSettings
  setRouting: (r: Partial<RoutingSettings>) => void
  setRoutingFromEngine: (r: Partial<RoutingSettings>) => void
  realInputDevices:  string[]
  realOutputDevices: string[]
  realBackends: string[]
  realInputChannels: string[]
  realOutputChannels: string[]
  setRealDevices: (inputs: string[], outputs: string[]) => void
  setRealBackends: (b: string[]) => void
  setRealChannels: (inputs: string[], outputs: string[]) => void

  // Persistence
  hydrate: (data: Record<string, unknown>) => void
  pendingRestore: boolean

  // Modals
  showAddPlugin:    boolean
  setShowAddPlugin: (v: boolean) => void
  showSavePreset:   boolean
  setShowSavePreset:(v: boolean) => void
  showShortcuts:    boolean
  setShowShortcuts: (v: boolean) => void
}

export const useStore = create<AppState>((set, get) => ({
  activeSection:    'studio',
  setActiveSection: (s) => set({ activeSection: s }),

  theme:       'dark',
  toggleTheme: () => { set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })); schedulePersist() },

  startWithWindows: false,
  startMinimized: false,
  closeToTray:    true,
  autoBypass:     false,
  scanPaths:      ['C:\\Program Files\\Common Files\\VST3'],
  setSetting: (key, v) => { set({ [key]: v } as Partial<AppState>); schedulePersist() },
  setScanPaths: (paths) => { set({ scanPaths: paths }); schedulePersist() },

  engineConnected:    false,
  setEngineConnected: (v) => set({ engineConnected: v }),
  engineScanProgress: null,
  setScanProgress: (plugin, progress) => set({ engineScanProgress: { plugin, progress } }),
  setScanFinished: () => set({ engineScanProgress: null }),
  engineError: null,
  setEngineError: (msg) => set({ engineError: msg }),

  slots:       [],
  inputGain:   0,
  outputGain:  0,
  bypassAll:   false,
  inputLevel:  0,
  outputLevel: 0,
  presetModified: false,

  setInputGain:  (v) => { set({ inputGain: v, presetModified: true }); sendEngineCommand({ cmd: 'set_input_gain', value: v }) },
  setOutputGain: (v) => { set({ outputGain: v, presetModified: true }); sendEngineCommand({ cmd: 'set_output_gain', value: v }) },

  toggleBypassAll: () => {
    const next = !get().bypassAll
    set({ bypassAll: next })
    sendEngineCommand({ cmd: 'bypass_all', value: next })
  },
  setBypassAllState: (v) => set({ bypassAll: v }),

  toggleSlotEnabled: (id) => {
    const idx = get().slots.findIndex(s => s.id === id)
    if (idx < 0) return
    const enabled = !get().slots[idx].enabled
    set(s => ({ slots: s.slots.map(sl => sl.id === id ? { ...sl, enabled } : sl), presetModified: true }))
    sendEngineCommand({ cmd: 'set_plugin_enabled', index: idx, value: enabled })
  },

  toggleSlotBypassed: (id) => {
    const idx = get().slots.findIndex(s => s.id === id)
    if (idx < 0) return
    const bypassed = !get().slots[idx].bypassed
    set(s => ({ slots: s.slots.map(sl => sl.id === id ? { ...sl, bypassed } : sl), presetModified: true }))
    sendEngineCommand({ cmd: 'set_plugin_bypassed', index: idx, value: bypassed })
  },

  toggleSlotExpanded: (id) =>
    set(s => ({ slots: s.slots.map(sl => sl.id === id ? { ...sl, expanded: !sl.expanded } : sl) })),

  removeSlot: (id) => {
    const idx = get().slots.findIndex(s => s.id === id)
    if (idx < 0) return
    set(s => ({ slots: s.slots.filter(sl => sl.id !== id), presetModified: true }))
    sendEngineCommand({ cmd: 'remove_plugin', index: idx })
  },

  addPluginToSlot: (plugin, index) => {
    // Identify by file + unique id (shells like Waves pack many in one file).
    // Fall back to id-as-file for plugins persisted before uid existed.
    const cmd: Record<string, unknown> = {
      cmd: 'add_plugin',
      file: plugin.file || plugin.id,
      uid:  plugin.uid || '',
    }
    if (index !== undefined && index >= 0) cmd.index = index
    sendEngineCommand(cmd)
    set({ showAddPlugin: false, presetModified: true })
  },

  reorderSlots: (from, to) => {
    set(s => {
      const slots = [...s.slots]
      const [item] = slots.splice(from, 1)
      slots.splice(to, 0, item)
      return { slots, presetModified: true }
    })
    sendEngineCommand({ cmd: 'move_plugin', from, to })
  },

  updateParam: (slotId, paramId, value) => {
    const slotIdx = get().slots.findIndex(s => s.id === slotId)
    set(s => ({
      slots: s.slots.map(sl =>
        sl.id !== slotId ? sl : {
          ...sl,
          plugin: {
            ...sl.plugin,
            parameters: sl.plugin.parameters.map(p => p.id === paramId ? { ...p, value } : p),
          },
        }),
      presetModified: true,
    }))
    if (slotIdx >= 0) {
      const paramIdx = parseInt(paramId, 10)
      if (!isNaN(paramIdx)) {
        const param = get().slots[slotIdx]?.plugin.parameters.find(p => p.id === paramId)
        if (param) {
          const normalised = (value - param.min) / (param.max - param.min || 1)
          sendEngineCommand({ cmd: 'set_param', slotIndex: slotIdx, paramIndex: paramIdx, value: normalised })
        }
      }
    }
  },

  openEditor: (id) => {
    const idx = get().slots.findIndex(s => s.id === id)
    if (idx >= 0) sendEngineCommand({ cmd: 'open_editor', index: idx })
  },

  setLevels: (input, output) => set({ inputLevel: input, outputLevel: output }),

  setChainFromEngine: (raw) => {
    const slots = (raw as Record<string, unknown>[]).map(rawToSlot)
    set({ slots })
    // If a save is pending, the engine just sent a FRESH snapshot (with live
    // plugin state) — persist it now.
    const { pendingSaveName, inputGain, outputGain } = get()
    if (pendingSaveName) {
      set({ pendingSaveName: null })
      savePresetData(pendingSaveName, {
        name: pendingSaveName, inputGain, outputGain, chain: serializeChain(slots),
      }).then(() => get().refreshPresets())
    }
  },
  pendingSaveName: null,

  // ── Presets ──────────────────────────────────────────────────────────────────
  presets:        [],
  activePresetId: null,

  loadPreset: (id) => {
    const preset = get().presets.find(p => p.id === id)
    if (!preset) return
    // Guard against losing unsaved tweaks when switching presets
    if (get().presetModified && get().activePresetId && get().activePresetId !== id) {
      if (!window.confirm('Discard unsaved changes to the current preset?')) return
    }
    set({ activePresetId: id, presetModified: false })
    loadPresetData(preset.name).then(data => {
      if (!data) return
      sendEngineCommand({ cmd: 'load_chain', chain: (data['chain'] as unknown[]) ?? [] })
      get().setInputGain((data['inputGain'] as number) ?? 0)
      get().setOutputGain((data['outputGain'] as number) ?? 0)
      set({ presetModified: false })
    })
    schedulePersist()
  },

  savePreset: (name) => {
    // Ask the engine for a fresh chain snapshot (current plugin state), then
    // setChainFromEngine persists it (see pendingSaveName).
    set({ pendingSaveName: name, activePresetId: `eng-${name}`, showSavePreset: false, presetModified: false })
    sendEngineCommand({ cmd: 'get_chain' })
    schedulePersist()
  },

  updatePreset: () => {
    const { activePresetId, presets } = get()
    const preset = presets.find(p => p.id === activePresetId)
    if (!preset) return
    set({ pendingSaveName: preset.name, presetModified: false })
    sendEngineCommand({ cmd: 'get_chain' })
  },

  deletePreset: (id) => {
    const preset = get().presets.find(p => p.id === id)
    if (preset) deletePresetData(preset.name).then(() => get().refreshPresets())
    set(s => ({ activePresetId: s.activePresetId === id ? null : s.activePresetId }))
  },

  duplicatePreset: (id) => {
    const preset = get().presets.find(p => p.id === id)
    if (!preset) return
    const { slots, inputGain, outputGain } = get()
    const name = `${preset.name} (copy)`
    savePresetData(name, { name, inputGain, outputGain, chain: serializeChain(slots) })
      .then(() => get().refreshPresets())
  },

  refreshPresets: () => {
    listPresetData().then(list => {
      const presets: Preset[] = list.map(ep => ({
        id: `eng-${ep.name}`, name: ep.name, description: '', createdAt: '',
        slots: [], inputGain: 0, outputGain: 0,
      }))
      set({ presets })
      const { pendingRestore, activePresetId } = get()
      if (pendingRestore && activePresetId && presets.some(p => p.id === activePresetId)) {
        set({ pendingRestore: false })
        get().loadPreset(activePresetId)
      } else if (pendingRestore) {
        set({ pendingRestore: false })
      }
    })
  },

  setEnginePresets: () => { /* presets now come from Rust via refreshPresets() */ },
  pendingRestore: false,

  availablePlugins: [],
  toggleFavorite: (id) => {
    set(s => ({ availablePlugins: s.availablePlugins.map(p => p.id === id ? { ...p, favorite: !p.favorite } : p) }))
    schedulePersist()
  },

  setScannedPlugins: (raw) => {
    const favs = new Set(get().availablePlugins.filter(p => p.favorite).map(p => p.id))
    const seen = new Set<string>()
    const plugins: Plugin[] = (raw as Record<string, unknown>[])
      .filter(r => !r['isInstrument'])           // mic processing → effects only
      .map(r => ({
        id:           String(r['uid'] ?? r['file']),   // unique even inside shells
        file:         String(r['file']),
        uid:          String(r['uid'] ?? ''),
        name:         String(r['name']),
        manufacturer: String(r['manufacturer'] ?? ''),
        format:       'VST3' as const,
        category:     String(r['category'] ?? ''),
        latency:      0,
        favorite:     favs.has(String(r['uid'] ?? r['file'])),
        parameters:   [],
      }))
      // Drop exact duplicates by unique id
      .filter(p => {
        if (seen.has(p.id)) return false
        seen.add(p.id)
        return true
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    set({ availablePlugins: plugins, engineScanProgress: null })
    schedulePersist()
  },

  routing:    DEFAULT_ROUTING,
  setRouting: (r) => {
    set(s => ({ routing: { ...s.routing, ...r } }))
    if (r.backend)        sendEngineCommand({ cmd: 'set_backend', name: r.backend })
    if (r.sampleRate)     sendEngineCommand({ cmd: 'set_sample_rate', value: r.sampleRate })
    if (r.bufferSize)     sendEngineCommand({ cmd: 'set_buffer_size', value: r.bufferSize })
    if (r.inputDeviceId)  sendEngineCommand({ cmd: 'set_input_device',  name: r.inputDeviceId })
    if (r.outputDeviceId) sendEngineCommand({ cmd: 'set_output_device', name: r.outputDeviceId })
    if (r.inputChannel  !== undefined) sendEngineCommand({ cmd: 'set_input_channel',  index: r.inputChannel })
    if (r.outputChannel !== undefined) sendEngineCommand({ cmd: 'set_output_channel', index: r.outputChannel })
    schedulePersist()
  },
  setRoutingFromEngine: (r) => {
    const clean: Partial<RoutingSettings> = {}
    if (r.backend         !== undefined) clean.backend         = r.backend
    if (r.sampleRate      !== undefined) clean.sampleRate      = r.sampleRate
    if (r.bufferSize      !== undefined) clean.bufferSize      = r.bufferSize
    if (r.inputDeviceId   !== undefined) clean.inputDeviceId   = r.inputDeviceId
    if (r.outputDeviceId  !== undefined) clean.outputDeviceId  = r.outputDeviceId
    if (r.virtualOutputId !== undefined) clean.virtualOutputId = r.virtualOutputId
    if (r.inputChannel    !== undefined) clean.inputChannel    = r.inputChannel
    if (r.outputChannel   !== undefined) clean.outputChannel   = r.outputChannel
    set(s => ({ routing: { ...s.routing, ...clean } }))
  },

  realInputDevices:  [],
  realOutputDevices: [],
  realBackends:      [],
  realInputChannels: [],
  realOutputChannels: [],
  setRealDevices: (inputs, outputs) => set({ realInputDevices: inputs, realOutputDevices: outputs }),
  setRealBackends: (b) => set({ realBackends: b }),
  setRealChannels: (inputs, outputs) => set({ realInputChannels: inputs, realOutputChannels: outputs }),

  // ── Persistence ────────────────────────────────────────────────────────────
  hydrate: (data) => {
    const r = data as Partial<AppState>
    set({
      theme:            (r.theme as Theme) ?? get().theme,
      startWithWindows: r.startWithWindows ?? get().startWithWindows,
      startMinimized:   r.startMinimized ?? get().startMinimized,
      closeToTray:      r.closeToTray ?? get().closeToTray,
      autoBypass:       r.autoBypass ?? get().autoBypass,
      scanPaths:        r.scanPaths ?? get().scanPaths,
      availablePlugins: (r.availablePlugins as Plugin[]) ?? get().availablePlugins,
      routing:          { ...get().routing, ...(r.routing ?? {}) },
      activePresetId:   r.activePresetId ?? null,
      pendingRestore:   !!r.activePresetId,
    })
  },

  showAddPlugin:    false,
  setShowAddPlugin: (v) => set({ showAddPlugin: v }),
  showSavePreset:   false,
  setShowSavePreset:(v) => set({ showSavePreset: v }),
  showShortcuts:    false,
  setShowShortcuts: (v) => set({ showShortcuts: v }),
}))
