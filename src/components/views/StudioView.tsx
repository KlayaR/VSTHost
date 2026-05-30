import React, { useState } from 'react'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../../store/useStore'
import type { Plugin } from '../../types'
import LevelMeter from '../LevelMeter'
import PluginSlotRow from '../rack/PluginSlotRow'
import GainKnob from '../rack/GainKnob'

const SAMPLE_RATES = [44100, 48000, 88200, 96000]
const BUFFER_SIZES = [32, 64, 128, 256, 512, 1024]

// Shared drag state (module-level: simplest reliable way across panels)
let draggedPlugin: Plugin | null = null

// Turn a raw VST3 category ("Fx|EQ", "Fx|Dynamics|EQ", "Fx", "") into a clean
// label using the first meaningful subcategory.
function catLabel(raw: string): string {
  if (!raw) return 'Uncategorized'
  const parts = raw.split('|').map(p => p.trim()).filter(p => p && p !== 'Fx')
  return parts.length ? parts[0] : 'Effect'
}

export default function StudioView() {
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <RoutingPanel />
      <RackPanel />
      <SidePanel />
    </div>
  )
}

/* ───────────────────────── LEFT: Routing ───────────────────────── */
function RoutingPanel() {
  const routing            = useStore(s => s.routing)
  const setRouting         = useStore(s => s.setRouting)
  const engineConnected    = useStore(s => s.engineConnected)
  const realInputDevices   = useStore(s => s.realInputDevices)
  const realOutputDevices  = useStore(s => s.realOutputDevices)
  const realBackends       = useStore(s => s.realBackends)
  const realInputChannels  = useStore(s => s.realInputChannels)
  const realOutputChannels = useStore(s => s.realOutputChannels)
  const realVirtualOutputs = useStore(s => s.realVirtualOutputs)
  const isAsio = routing.backend === 'ASIO'
  const latencyMs = ((routing.bufferSize / routing.sampleRate) * 1000).toFixed(2)

  return (
    <div style={{
      width: 290, flexShrink: 0,
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border)',
      overflowY: 'auto',
      display: 'flex', flexDirection: 'column',
    }}>
      <PanelHeader title="Routing" />
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!engineConnected && (
          <div style={{ background: 'rgba(245,200,66,0.08)', border: '1px solid rgba(245,200,66,0.3)', borderRadius: 8, padding: '8px 10px', fontSize: 10.5, color: 'var(--yellow)', lineHeight: 1.4 }}>
            Audio engine offline.
          </div>
        )}

        <Field label="Driver Type" hint={isAsio ? 'ASIO — hardware-direct, lowest latency' : 'Pick an ASIO driver for lowest latency'} hintColor={isAsio ? 'var(--green)' : 'var(--yellow)'}>
          <Select value={routing.backend} options={realBackends} onChange={v => setRouting({ backend: v })} placeholder="—" />
        </Field>

        {isAsio ? (
          /* ASIO = one device with many channels (ADAT/Analog). Pick the
             interface once, then choose the in/out channels within it. */
          <>
            <Field label="Interface">
              <Select value={routing.inputDeviceId} options={realInputDevices} onChange={v => setRouting({ inputDeviceId: v, outputDeviceId: v })} placeholder="Select device…" />
            </Field>
            {realInputChannels.length > 1 && (
              <Field label="Input Channel">
                <ChannelSelect channels={realInputChannels} value={routing.inputChannel} onChange={v => setRouting({ inputChannel: v })} stereo={false} />
              </Field>
            )}
            {realOutputChannels.length > 1 && (
              <Field label="Output Channel">
                <ChannelSelect channels={realOutputChannels} value={routing.outputChannel} onChange={v => setRouting({ outputChannel: v })} stereo />
              </Field>
            )}
          </>
        ) : (
          /* WASAPI/DirectSound = each channel pair is its own device. */
          <>
            <Field label="Input Device">
              <Select value={routing.inputDeviceId} options={realInputDevices} onChange={v => setRouting({ inputDeviceId: v })} placeholder="Select device…" />
            </Field>
            <Field label="Output Device">
              <Select value={routing.outputDeviceId} options={realOutputDevices} onChange={v => setRouting({ outputDeviceId: v })} placeholder="Select device…" />
            </Field>
          </>
        )}

        <Field label="Virtual Output (to apps)" hint="Send to Discord / Zoom / OBS via a virtual cable">
          <Select
            value={routing.virtualOutputId || '(off)'}
            options={['(off)', ...realVirtualOutputs]}
            onChange={v => setRouting({ virtualOutputId: v === '(off)' ? '' : v })}
            placeholder="(off)"
          />
        </Field>

        <div className="divider" />

        <Field label="Sample Rate">
          <select value={routing.sampleRate} onChange={e => setRouting({ sampleRate: parseInt(e.target.value) })}>
            {SAMPLE_RATES.map(sr => <option key={sr} value={sr}>{(sr / 1000).toFixed(sr % 1000 === 0 ? 0 : 1)} kHz</option>)}
          </select>
        </Field>
        <Field label="Buffer Size" hint={`${latencyMs} ms latency`} hintColor={parseFloat(latencyMs) < 6 ? 'var(--green)' : 'var(--yellow)'}>
          <select value={routing.bufferSize} onChange={e => setRouting({ bufferSize: parseInt(e.target.value) })}>
            {BUFFER_SIZES.map(bs => <option key={bs} value={bs}>{bs} samples</option>)}
          </select>
        </Field>
      </div>
    </div>
  )
}

/** Thin vertical separator for grouping toolbar buttons by concern. */
function ToolbarDivider() {
  return <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 3px', flexShrink: 0 }} />
}

function ChannelSelect({ channels, value, onChange, stereo }: { channels: string[]; value: number; onChange: (v: number) => void; stereo: boolean }) {
  // For stereo output, present pairs (0,2,4…); for mono input, every channel.
  const opts: { idx: number; label: string }[] = []
  if (stereo) {
    for (let i = 0; i + 1 < channels.length; i += 2) opts.push({ idx: i, label: `${channels[i]} / ${channels[i + 1]}` })
  } else {
    channels.forEach((c, i) => opts.push({ idx: i, label: c }))
  }
  return (
    <select value={value} onChange={e => onChange(parseInt(e.target.value))}>
      {value < 0 && <option value={-1}>Default</option>}
      {opts.map(o => <option key={o.idx} value={o.idx}>{o.label}</option>)}
    </select>
  )
}

/* ───────────────────────── MIDDLE: Rack ───────────────────────── */
function RackPanel() {
  // Granular selectors so this panel does NOT re-render on 30fps level updates
  // (which would otherwise cancel an in-progress HTML5 drag).
  const slots           = useStore(s => s.slots)
  const inputGain       = useStore(s => s.inputGain)
  const outputGain      = useStore(s => s.outputGain)
  const bypassAll       = useStore(s => s.bypassAll)
  const setInputGain    = useStore(s => s.setInputGain)
  const setOutputGain   = useStore(s => s.setOutputGain)
  const toggleBypassAll = useStore(s => s.toggleBypassAll)
  const setShowSavePreset = useStore(s => s.setShowSavePreset)
  const reorderSlots    = useStore(s => s.reorderSlots)
  const addPluginToSlot = useStore(s => s.addPluginToSlot)
  const muted           = useStore(s => s.muted)
  const toggleMute      = useStore(s => s.toggleMute)
  const monitorMuted    = useStore(s => s.monitorMuted)
  const toggleMonitor   = useStore(s => s.toggleMonitor)
  const undo            = useStore(s => s.undo)
  const undoStack       = useStore(s => s.undoStack)

  const [dragIdx, setDragIdx] = useState<number | null>(null)   // reorder source
  const [insertAt, setInsertAt] = useState<number | null>(null) // plugin-add insertion point
  // Only allow slot-reorder drag when it originates from the drag handle,
  // not from sliders, buttons, or other interactive children.
  const dragFromHandle = React.useRef(false)

  // Compute insertion index from cursor position over a slot (top/bottom half)
  const overSlot = (e: React.DragEvent, i: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = draggedPlugin ? 'copy' : 'move'
    if (draggedPlugin) {
      const r = e.currentTarget.getBoundingClientRect()
      setInsertAt(e.clientY > r.top + r.height / 2 ? i + 1 : i)
    }
  }

  const onChainDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (draggedPlugin) {
      addPluginToSlot(draggedPlugin, insertAt ?? slots.length)
      draggedPlugin = null
    }
    setInsertAt(null)
  }

  const InsertLine = ({ show }: { show: boolean }) => (
    <div style={{ height: show ? 3 : 0, background: 'var(--accent)', borderRadius: 2, margin: show ? '2px 0' : 0, boxShadow: show ? '0 0 6px var(--accent)' : 'none', transition: 'height 0.08s' }} />
  )

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
      {/* Toolbar */}
      <div style={{ height: 44, padding: '0 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface)', flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Signal Chain</span>
        <div style={{ flex: 1 }} />

        {/* ── Undo ── */}
        <button
          className="btn btn-ghost"
          onClick={undo}
          disabled={undoStack.length === 0}
          title={`Undo last chain change (Ctrl+Z)${undoStack.length > 0 ? ` · ${undoStack.length} step${undoStack.length > 1 ? 's' : ''} available` : ''}`}
          style={{ fontSize: 11, opacity: undoStack.length === 0 ? 0.35 : 1 }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1.5 4.5h5a3 3 0 010 6H4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M1.5 4.5L4 2M1.5 4.5L4 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Undo<kbd style={{ fontSize: 9, background: 'var(--bg-active)', padding: '0 4px', borderRadius: 2 }}>Ctrl+Z</kbd>
        </button>

        <ToolbarDivider />

        {/* ── Chain processing ── */}
        <button className="btn btn-ghost" onClick={toggleBypassAll} title="Bypass every plugin in the chain (signal passes through clean)" style={{ fontSize: 11, background: bypassAll ? 'rgba(245,200,66,0.2)' : undefined, color: bypassAll ? 'var(--yellow)' : undefined, borderColor: bypassAll ? 'var(--yellow)' : undefined }}>
          <svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.4" fill="none" /><path d="M2 10L10 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          {bypassAll ? 'Bypassed' : 'Bypass All'}<kbd style={{ fontSize: 9, background: 'var(--bg-active)', padding: '0 4px', borderRadius: 2 }}>Space</kbd>
        </button>

        <ToolbarDivider />

        {/* ── Listening / output ── */}
        <button
          className="btn btn-ghost"
          onClick={toggleMonitor}
          title={monitorMuted
            ? 'Local monitor is OFF — you hear nothing, but apps still receive the send'
            : 'You are monitoring — you hear the processed mic locally'}
          style={{ fontSize: 11, background: monitorMuted ? undefined : 'rgba(80,200,120,0.16)', color: monitorMuted ? 'var(--text-secondary)' : 'var(--green)', borderColor: monitorMuted ? undefined : 'var(--green)' }}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M2 5h3l3.5-3v10L5 9H2V5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            {monitorMuted
              ? <path d="M11 5l2.5 4M13.5 5L11 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              : <path d="M10.5 5a3.2 3.2 0 010 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
          </svg>
          {monitorMuted ? 'Monitor Off' : 'Monitor'}
        </button>
        <button
          className="btn btn-ghost"
          onClick={toggleMute}
          title="Master mute — kills both your monitor AND the send to apps"
          style={{ fontSize: 11, background: muted ? 'rgba(255,85,85,0.18)' : undefined, color: muted ? 'var(--red)' : undefined, borderColor: muted ? 'var(--red)' : undefined }}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M2 5h2.5L8 2v10L4.5 9H2V5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            {muted
              ? <path d="M10.5 5l3 3M13.5 5l-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              : <path d="M10.5 5a3.2 3.2 0 010 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
          </svg>
          {muted ? 'Muted' : 'Mute'}
        </button>

        <ToolbarDivider />

        {/* ── Preset ── */}
        <button className="btn btn-ghost" onClick={() => setShowSavePreset(true)} title="Save the current chain as a preset" style={{ fontSize: 11 }}>
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" /><path d="M3 7.5L5 9.5L9 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Save<kbd style={{ fontSize: 9, background: 'var(--bg-active)', padding: '0 4px', borderRadius: 2 }}>Ctrl+S</kbd>
        </button>
      </div>

      {/* Meters (isolated: only this re-renders on level updates) */}
      <Meters />

      {/* Chain */}
      <div
        style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}
        onDragOver={e => {
          // Make the whole chain a valid drop target (gaps, arrows, blocks).
          if (draggedPlugin) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            if (insertAt === null) setInsertAt(slots.length)
          }
        }}
        onDragLeave={e => { if (e.currentTarget === e.target) setInsertAt(null) }}
        onDrop={onChainDrop}
      >
        <InputBlock inputGain={inputGain} setInputGain={setInputGain} />
        <ChainArrow />

        {slots.length === 0 ? (
          <div
            onDragOver={e => { if (draggedPlugin) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setInsertAt(0) } }}
            style={{
              background: 'var(--bg-elevated)',
              border: `1px dashed ${insertAt === 0 ? 'var(--accent)' : 'var(--border-light)'}`,
              borderRadius: 8, padding: '28px',
              color: insertAt === 0 ? 'var(--accent)' : 'var(--text-muted)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, fontSize: 12, textAlign: 'center',
              transition: 'border-color 0.1s, color 0.1s',
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" /><path d="M12 7v10M7 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            Drag a plugin here from the right panel
          </div>
        ) : (
          <>
            <InsertLine show={draggedPlugin !== null && insertAt === 0} />
            {slots.map((slot, i) => (
              <React.Fragment key={slot.id}>
                <div
                  draggable
                  onDragStart={e => {
                    if (!dragFromHandle.current) { e.preventDefault(); return }
                    setDragIdx(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i))
                  }}
                  onDragOver={e => overSlot(e, i)}
                  onDrop={e => {
                    e.preventDefault()
                    if (!draggedPlugin && dragIdx !== null && dragIdx !== i) reorderSlots(dragIdx, i)
                    setDragIdx(null)
                  }}
                  onDragEnd={() => { setDragIdx(null); setInsertAt(null); dragFromHandle.current = false }}
                  style={{ opacity: dragIdx === i ? 0.4 : 1, borderRadius: 8, transition: 'opacity 0.1s' }}
                >
                  <PluginSlotRow slot={slot} index={i} globalBypass={bypassAll} onHandleMouseDown={() => { dragFromHandle.current = true }} />
                </div>
                {draggedPlugin !== null
                  ? <InsertLine show={insertAt === i + 1} />
                  : <ChainArrow small />}
              </React.Fragment>
            ))}
          </>
        )}

        <OutputBlock outputGain={outputGain} setOutputGain={setOutputGain} />
        <div style={{ height: 12 }} />
      </div>
    </div>
  )
}

/* Isolated meters — subscribes only to levels, so 30fps updates don't
   re-render the rack/plugins (which would cancel an active drag). */
function Meters() {
  const inputLevel  = useStore(s => s.inputLevel)
  const outputLevel = useStore(s => s.outputLevel)
  const bypassAll   = useStore(s => s.bypassAll)
  return (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
      <LevelMeter level={bypassAll ? 0 : inputLevel} vertical={false} height={10} label="INPUT" />
      <LevelMeter level={bypassAll ? 0 : outputLevel} vertical={false} height={10} label="OUTPUT" />
    </div>
  )
}

/* ───────────────────────── RIGHT: Presets + Plugins ───────────────────────── */
function SidePanel() {
  const presets           = useStore(s => s.presets)
  const activePresetId    = useStore(s => s.activePresetId)
  const loadPreset        = useStore(s => s.loadPreset)
  const deletePreset      = useStore(s => s.deletePreset)
  const renamePreset      = useStore(s => s.renamePreset)
  const refreshPresets    = useStore(s => s.refreshPresets)
  const updatePreset      = useStore(s => s.updatePreset)
  const presetModified    = useStore(s => s.presetModified)
  const availablePlugins  = useStore(s => s.availablePlugins)
  const engineConnected   = useStore(s => s.engineConnected)
  const engineScanProgress = useStore(s => s.engineScanProgress)
  const toggleFavorite    = useStore(s => s.toggleFavorite)
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('All')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal,  setRenameVal]  = useState('')
  const scanning = engineScanProgress !== null

  // Distinct categories present in the scanned plugins (from VST3 metadata)
  const categories = Array.from(new Set(availablePlugins.map(p => catLabel(p.category)))).sort()

  const filtered = availablePlugins.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.manufacturer.toLowerCase().includes(search.toLowerCase())
    const matchCat = cat === 'All' ? true : cat === '★ Favorites' ? p.favorite : catLabel(p.category) === cat
    return matchSearch && matchCat
  })

  return (
    <div style={{ width: 270, flexShrink: 0, background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Presets dropdown */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <div className="section-header" style={{ marginBottom: 6 }}>Preset</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={activePresetId ?? ''}
            onChange={e => e.target.value && loadPreset(e.target.value)}
            style={{ flex: 1 }}
          >
            <option value="">{presets.length ? 'Select preset…' : 'No presets saved'}</option>
            {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {activePresetId && (
            <button
              className="btn-icon"
              data-tip={presetModified ? 'Update preset (unsaved changes)' : 'Update preset'}
              onClick={updatePreset}
              style={{ flexShrink: 0, color: presetModified ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M2 2h7l2 2v7H2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                <path d="M4.5 2v3h4V2M4.5 11V8h4v3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {activePresetId && (
            <button className="btn-icon" data-tip="Rename preset" onClick={() => {
              const p = presets.find(x => x.id === activePresetId)
              if (p) { setRenamingId(p.id); setRenameVal(p.name) }
            }} style={{ flexShrink: 0 }}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M2 10h9M8.5 2.5l2 2-6 6H2.5v-2l6-6z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {activePresetId && (
            <button className="btn-icon" data-tip="Delete preset" onClick={() => activePresetId && deletePreset(activePresetId)} style={{ flexShrink: 0 }}>
              <svg width="13" height="13" viewBox="0 0 11 13" fill="none"><path d="M1 3h9M4 3V2h3v1M2 3l.5 8h6l.5-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          )}
          {activePresetId && (
            <button className="btn-icon" data-tip="Export preset to file" style={{ flexShrink: 0 }} onClick={async () => {
              const preset = presets.find(p => p.id === activePresetId)
              if (!preset) return
              const dest = await saveDialog({ defaultPath: `${preset.name}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] }).catch(() => null)
              if (dest) invoke('export_preset', { name: preset.name, destPath: dest }).catch(e => useStore.getState().setEngineError(String(e)))
            }}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M6.5 1v7M4 6l2.5 2.5L9 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 10h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
          )}
          <button className="btn-icon" data-tip="Import preset from file" style={{ flexShrink: 0 }} onClick={async () => {
            const src = await openDialog({ filters: [{ name: 'JSON', extensions: ['json'] }], multiple: false }).catch(() => null)
            if (!src || typeof src !== 'string') return
            const name = await invoke<string>('import_preset', { srcPath: src }).catch(e => { useStore.getState().setEngineError(String(e)); return null })
            if (name) { refreshPresets(); useStore.getState().setEngineWarning(`Imported "${name}"`) }
          }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 9V2M4 4.5L6.5 2 9 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 10h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        {renamingId && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input
              autoFocus
              value={renameVal}
              onChange={e => setRenameVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && renameVal.trim()) { renamePreset(renamingId, renameVal.trim()); setRenamingId(null) }
                if (e.key === 'Escape') setRenamingId(null)
              }}
              style={{ flex: 1, fontSize: 11 }}
            />
            <button className="btn btn-primary" style={{ fontSize: 11 }} onClick={() => { if (renameVal.trim()) { renamePreset(renamingId, renameVal.trim()); setRenamingId(null) } }}>OK</button>
            <button className="btn btn-ghost"   style={{ fontSize: 11 }} onClick={() => setRenamingId(null)}>✕</button>
          </div>
        )}
      </div>

      {/* Plugins */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span className="section-header" style={{ padding: 0 }}>Plugins</span>
          <div style={{ flex: 1 }} />
          <ScanButton scanning={scanning} disabled={!engineConnected} />
        </div>
        <div style={{ position: 'relative', marginBottom: 6 }}>
          <svg width="12" height="12" viewBox="0 0 13 13" fill="none" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}>
            <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.4" /><path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 27, fontSize: 11 }}
          />
        </div>
        <select value={cat} onChange={e => setCat(e.target.value)} style={{ fontSize: 11 }}>
          <option value="All">All categories</option>
          <option value="★ Favorites">★ Favorites</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {scanning && engineScanProgress && (
          <div style={{ marginTop: 8 }}>
            <div style={{ height: 3, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${engineScanProgress.progress * 100}%`, background: 'var(--accent)', transition: 'width 0.2s' }} />
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {filtered.map((plugin, i) => (
          <div
            key={`${plugin.id}::${plugin.name}::${i}`}
            draggable
            onDragStart={e => { draggedPlugin = plugin; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', plugin.id) }}
            onDragEnd={() => { draggedPlugin = null }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 6, cursor: 'grab', transition: 'background 0.08s' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <svg width="8" height="13" viewBox="0 0 8 14" fill="var(--text-muted)" style={{ flexShrink: 0 }}>
              <circle cx="2" cy="3" r="1.5" /><circle cx="6" cy="3" r="1.5" /><circle cx="2" cy="7" r="1.5" /><circle cx="6" cy="7" r="1.5" /><circle cx="2" cy="11" r="1.5" /><circle cx="6" cy="11" r="1.5" />
            </svg>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plugin.name}</div>
              <div style={{ fontSize: 9.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plugin.manufacturer || '—'}</div>
            </div>
            <button className="btn-icon" onClick={() => toggleFavorite(plugin.id)} style={{ color: plugin.favorite ? 'var(--yellow)' : 'var(--text-muted)', flexShrink: 0, padding: 2 }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill={plugin.favorite ? 'var(--yellow)' : 'none'}><path d="M7 1.5l1.8 3.6 4 .58-2.9 2.83.69 4L7 10.35 3.41 12.5l.69-4L1.2 5.68l4-.58z" stroke={plugin.favorite ? 'var(--yellow)' : 'currentColor'} strokeWidth="1.2" strokeLinejoin="round" /></svg>
            </button>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '30px 12px', fontSize: 11, lineHeight: 1.5 }}>
            {availablePlugins.length === 0
              ? (engineConnected ? 'Click Scan to find your VST3 plugins.' : 'Waiting for the engine…')
              : 'No matches'}
          </div>
        )}
      </div>
    </div>
  )
}

function ScanButton({ scanning, disabled }: { scanning: boolean; disabled: boolean }) {
  const { scanPaths } = useStore()
  const start = () => {
    import('../../engine/engineBridge').then(m => m.sendEngineCommand({ cmd: 'scan_plugins', paths: scanPaths }))
  }
  return (
    <button className="btn btn-primary" onClick={start} disabled={scanning || disabled} style={{ fontSize: 10, padding: '3px 9px', opacity: (scanning || disabled) ? 0.6 : 1 }}>
      {scanning ? <span style={{ display: 'inline-block', width: 9, height: 9, border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} /> : 'Scan'}
    </button>
  )
}

/* ───────────────────────── shared bits ───────────────────────── */
function PanelHeader({ title }: { title: string }) {
  return (
    <div style={{ height: 44, padding: '0 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{title}</span>
    </div>
  )
}

function Field({ label, hint, hintColor, children }: { label: string; hint?: string; hintColor?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 9.5, color: hintColor ?? 'var(--text-muted)' }}>{hint}</span>}
    </div>
  )
}

function Select({ value, options, onChange, placeholder }: { value: string; options: string[]; onChange: (v: string) => void; placeholder: string }) {
  const has = options.length > 0
  return (
    <select value={value} onChange={e => onChange(e.target.value)} disabled={!has} style={{ opacity: has ? 1 : 0.5 }}>
      {(!value || !has) && <option value="">{has ? placeholder : 'None detected'}</option>}
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function InputBlock({ inputGain, setInputGain }: { inputGain: number; setInputGain: (v: number) => void }) {
  const inputDeviceId = useStore(s => s.routing.inputDeviceId)
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 9 }}>
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}><rect x="4.5" y="1" width="5" height="7" rx="2.5" stroke="var(--accent)" strokeWidth="1.3" /><path d="M2 7.5a5 5 0 0010 0" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" /><line x1="7" y1="12.5" x2="7" y2="10" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" /></svg>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>Input</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {inputDeviceId || 'No device'}
      </span>
      <CompactGain value={inputGain} onChange={setInputGain} label="GAIN" />
    </div>
  )
}

function OutputBlock({ outputGain, setOutputGain }: { outputGain: number; setOutputGain: (v: number) => void }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 9 }}>
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}><circle cx="7" cy="7" r="5.5" stroke="var(--green)" strokeWidth="1.3" /><path d="M4.5 7l2 2 3-3" stroke="var(--green)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>Output</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        To monitor / virtual cable
      </span>
      <CompactGain value={outputGain} onChange={setOutputGain} label="VOL" />
    </div>
  )
}

// Compact horizontal gain control for the slim Input/Output rows
function CompactGain({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>{label}</span>
      <input
        type="range" min={-24} max={24} step={1} value={value}
        onChange={e => onChange(parseInt(e.target.value))}
        style={{ width: 80 }}
      />
      <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--mono)', width: 26, textAlign: 'right' }}>
        {value > 0 ? '+' : ''}{value}
      </span>
    </div>
  )
}

function ChainArrow({ small }: { small?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <svg width="10" height={small ? 8 : 14} viewBox={`0 0 10 ${small ? 8 : 14}`} fill="none">
        <line x1="5" y1="0" x2="5" y2={small ? 5 : 10} stroke="var(--border-light)" strokeWidth="1.5" />
        <path d={`M2 ${small ? 4 : 8} L5 ${small ? 7 : 13} L8 ${small ? 4 : 8}`} stroke="var(--border-light)" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
