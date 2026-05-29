/**
 * presets.ts — preset persistence via the Rust backend.
 *
 * Presets are stored as JSON in the Tauri app-config dir (reliably accessible
 * to the app process, unlike the engine's own AppData lookup). The engine only
 * rebuilds the audio chain from the data we pass it (`load_chain`).
 */

import { invoke } from '@tauri-apps/api/core'
import type { PluginSlot } from '../types'

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export interface PresetChainSlot {
  file: string
  enabled: boolean
  bypassed: boolean
  state?: string
  parameters: { index: number; value: number }[]
}

/** Serialize the current UI chain into the saved-preset format. */
export function serializeChain(slots: PluginSlot[]): PresetChainSlot[] {
  return slots.map(s => ({
    file:     s.plugin.id,
    enabled:  s.enabled,
    bypassed: s.bypassed,
    state:    s.state,      // full plugin state (preferred on load)
    parameters: s.plugin.parameters.map(p => ({
      index: parseInt(p.id, 10),
      value: p.value,
    })),
  }))
}

export async function listPresetData(): Promise<{ name: string }[]> {
  if (!inTauri()) return []
  try { return await invoke<{ name: string }[]>('list_presets') } catch { return [] }
}

export async function savePresetData(name: string, data: object): Promise<void> {
  if (!inTauri()) return
  try { await invoke('save_preset', { name, data }) } catch (e) { console.error('[save_preset]', e) }
}

export async function loadPresetData(name: string): Promise<Record<string, unknown> | null> {
  if (!inTauri()) return null
  try {
    return await invoke<Record<string, unknown> | null>('load_preset', { name })
  } catch {
    return null
  }
}

export async function deletePresetData(name: string): Promise<void> {
  if (!inTauri()) return
  try { await invoke('delete_preset', { name }) } catch { /* ignore */ }
}
