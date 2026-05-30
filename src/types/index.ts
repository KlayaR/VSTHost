export type PluginFormat = 'VST3'

export interface PluginParameter {
  id: string
  name: string
  value: number
  min: number
  max: number
  default: number
  unit: string
}

export interface Plugin {
  id: string               // unique per plugin (VST3 identifier) — even inside shells
  file: string             // .vst3 file path
  uid: string              // VST3 unique identifier string (disambiguates shells)
  name: string
  manufacturer: string
  format: PluginFormat
  category: string         // raw VST3 category, e.g. "Fx|EQ", "Fx|Dynamics"
  latency: number
  favorite: boolean
  parameters: PluginParameter[]
}

export interface PluginSlot {
  id: string
  plugin: Plugin
  enabled: boolean
  bypassed: boolean
  expanded: boolean
  editorOpen?: boolean
  state?: string          // base64 plugin state blob (full fidelity)
  loading?: boolean       // optimistic placeholder until the engine confirms
  gainDb?: number         // per-slot post-plugin gain in dB (0 = unity)
}

export interface Preset {
  id: string
  name: string
  description: string
  createdAt: string
  slots: PluginSlot[]
  inputGain: number
  outputGain: number
}

export interface RoutingSettings {
  backend: string          // audio driver type: "ASIO", "Windows Audio", …
  inputDeviceId: string
  outputDeviceId: string
  virtualOutputId: string
  inputChannel: number     // channel index within the device (-1 = default)
  outputChannel: number    // first channel of the stereo output pair
  sampleRate: number
  bufferSize: number
}

export type NavSection = 'studio' | 'settings'
export type Theme = 'dark' | 'light'
