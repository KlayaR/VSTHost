import type { RoutingSettings } from '../types'

// Startup defaults — overwritten by the engine's "ready"/"devices" events and
// by persisted state. All real data (plugins, presets, devices, chain, levels)
// comes from the C++ audio engine; there is no mock/sample data.
export const DEFAULT_ROUTING: RoutingSettings = {
  backend: '',
  inputDeviceId: '',
  outputDeviceId: '',
  virtualOutputId: '',
  inputChannel: -1,
  outputChannel: -1,
  sampleRate: 48000,
  bufferSize: 128,
}
