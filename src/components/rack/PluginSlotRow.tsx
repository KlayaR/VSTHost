import React from 'react'
import { useStore } from '../../store/useStore'
import type { PluginSlot } from '../../types'
import ParamSlider from './ParamSlider'

interface Props {
  slot: PluginSlot
  index: number
  globalBypass: boolean
  onHandleMouseDown?: () => void
}

// ── Isolated per-slot meter ────────────────────────────────────────────────────
// Subscribes only to its own levels so 30fps updates don't re-render the row.
// Green = output level. Orange overlay = gain reduction (input − output).
function SlotMeter({ index, active }: { index: number; active: boolean }) {
  const outLevel = useStore(s => s.slotLevels[index]   ?? 0)
  const inLevel  = useStore(s => s.slotInLevels[index] ?? 0)

  const gr = active && inLevel > 0.01
    ? Math.max(0, Math.min(1, (inLevel - outLevel) / inLevel))
    : 0

  const outColor = !active
    ? 'var(--text-muted)'
    : outLevel > 0.9 ? 'var(--red)'
    : outLevel > 0.7 ? 'var(--yellow)'
    : 'var(--green)'

  return (
    <div
      style={{ width: 56, height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden', position: 'relative', flexShrink: 0 }}
      title={gr > 0.02
        ? `Output: ${(outLevel * 100).toFixed(0)}%  ·  GR: −${(gr * 100).toFixed(0)}%`
        : `Output: ${(outLevel * 100).toFixed(0)}%`}
    >
      <div style={{
        position: 'absolute', top: 0, left: 0, bottom: 0,
        width: `${Math.min(1, outLevel) * 100}%`,
        background: outColor, transition: 'width 0.05s', borderRadius: 3,
      }} />
      {gr > 0.02 && (
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left:  `${Math.min(1, outLevel) * 100}%`,
          width: `${gr * Math.min(1, inLevel) * 100}%`,
          background: 'rgba(255,160,60,0.6)',
          transition: 'left 0.05s, width 0.05s',
        }} />
      )}
    </div>
  )
}

// ── Slot row ──────────────────────────────────────────────────────────────────
export default function PluginSlotRow({ slot, index, globalBypass, onHandleMouseDown }: Props) {
  const {
    toggleSlotEnabled, toggleSlotBypassed, toggleSlotExpanded,
    removeSlot, openEditor, setSlotGain,
    copySlotSettings, pasteSlotSettings, pluginClipboard,
  } = useStore()
  const { plugin, enabled, bypassed, expanded, gainDb = 0 } = slot
  const canPaste = pluginClipboard?.uid === plugin.uid
  const inactive = !enabled || bypassed || globalBypass
  const accent    = inactive ? 'var(--border)' : 'var(--accent)'

  // Tooltip with all the detail — keeps the subtitle row clean.
  const infoTip = [
    plugin.name, plugin.manufacturer, plugin.category,
    plugin.latency > 0 ? `Latency: ${((plugin.latency / 48000) * 1000).toFixed(1)}ms` : null,
  ].filter(Boolean).join('  ·  ')

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${inactive ? 'var(--border)' : 'var(--border-light)'}`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: 8, overflow: 'hidden',
      opacity: inactive ? 0.55 : 1,
      transition: 'opacity 0.15s, border-color 0.15s',
    }}>
      {/* ── Header row ── */}
      <div style={{ height: 44, display: 'flex', alignItems: 'center', padding: '0 8px', gap: 6, overflow: 'hidden' }}>

        {/* Drag handle */}
        <div
          className="drag-handle"
          style={{ flexShrink: 0, padding: '0 2px', cursor: 'grab', color: 'var(--text-muted)' }}
          onMouseDown={() => onHandleMouseDown?.()}
        >
          <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
            <circle cx="2" cy="3" r="1.5" /><circle cx="6" cy="3" r="1.5" />
            <circle cx="2" cy="7" r="1.5" /><circle cx="6" cy="7" r="1.5" />
            <circle cx="2" cy="11" r="1.5"/><circle cx="6" cy="11" r="1.5" />
          </svg>
        </div>

        {/* Index */}
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--mono)', width: 16, textAlign: 'center', flexShrink: 0 }}>
          {String(index + 1).padStart(2, '0')}
        </span>

        {/* ── Name block — takes all remaining space, never overflows ── */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }} title={infoTip}>
          <div style={{
            fontSize: 12, fontWeight: 600,
            color: slot.loading ? 'var(--text-muted)' : 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {plugin.name}
          </div>
          <div style={{
            fontSize: 10, color: 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            display: 'flex', gap: 5, alignItems: 'center',
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {plugin.manufacturer}
            </span>
            {plugin.latency > 0 && (
              <span style={{ color: 'var(--yellow)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
                +{((plugin.latency / 48000) * 1000).toFixed(1)}ms
              </span>
            )}
          </div>
        </div>

        {/* ── Fixed-width right section — never collapses ── */}

        {/* Meter */}
        <SlotMeter index={index} active={!inactive} />

        {/* Gain trim: slider + dB value */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, width: 96 }}
          title={`Slot gain: ${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB  ·  Ctrl+click to reset`}
        >
          <input
            type="range" min={-24} max={24} step={0.5}
            value={gainDb}
            onChange={e => setSlotGain(slot.id, parseFloat(e.target.value))}
            onClick={e => { if (e.ctrlKey) setSlotGain(slot.id, 0) }}
            onDragStart={e => e.preventDefault()}
            style={{ width: 62, flexShrink: 0, accentColor: Math.abs(gainDb) > 0.1 ? 'var(--yellow)' : 'var(--accent)', cursor: 'pointer' }}
          />
          <span style={{
            fontSize: 9.5, fontFamily: 'var(--mono)', width: 28, textAlign: 'right', flexShrink: 0,
            color: Math.abs(gainDb) > 0.1 ? 'var(--yellow)' : 'var(--text-muted)',
          }}>
            {gainDb >= 0 ? '+' : ''}{gainDb.toFixed(1)}
          </span>
        </div>

        {/* Editor button */}
        <button
          className="btn btn-ghost"
          onClick={() => openEditor(slot.id)}
          style={{ fontSize: 10, padding: '4px 8px', gap: 4, flexShrink: 0 }}
          title="Open plugin GUI window"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <rect x="1" y="1.5" width="9" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
            <path d="M1 3.6h9" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          Editor
        </button>

        {/* Icon-only controls */}
        <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexShrink: 0 }}>
          <button className="btn-icon" onClick={() => toggleSlotBypassed(slot.id)} title={bypassed ? 'Remove bypass' : 'Bypass plugin'} style={{ color: bypassed ? 'var(--yellow)' : 'var(--text-muted)' }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M2 11L11 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <button className="btn-icon" onClick={() => toggleSlotEnabled(slot.id)} title={enabled ? 'Disable plugin' : 'Enable plugin'} style={{ color: enabled ? 'var(--green)' : 'var(--text-muted)' }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 2v3.5M3.5 4a5 5 0 100 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="6.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.4" fill="none" />
            </svg>
          </button>
          <button className="btn-icon" onClick={() => toggleSlotExpanded(slot.id)} title={expanded ? 'Collapse parameters' : 'Expand parameters'} style={{ color: expanded ? 'var(--accent)' : 'var(--text-muted)' }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              <path d="M3 5l3.5 3.5L10 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="btn-icon" onClick={() => copySlotSettings(slot.id)} title="Copy settings to clipboard" style={{ color: 'var(--text-muted)' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="3" y="3" width="8" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
              <path d="M1 7V1h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {canPaste && (
            <button className="btn-icon" onClick={() => pasteSlotSettings(slot.id)} title={`Paste settings (${pluginClipboard?.name})`} style={{ color: 'var(--accent)' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="1" y="2" width="8" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
                <path d="M3.5 2V1h5v1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          )}
          <button className="btn-icon" onClick={() => removeSlot(slot.id)} title="Remove plugin from chain" style={{ color: 'var(--text-muted)' }}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded params */}
      {expanded && plugin.parameters.length > 0 && (
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '10px 12px 12px',
          background: 'var(--bg-elevated)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: '10px 16px',
        }}>
          {plugin.parameters.map(param => (
            <ParamSlider key={param.id} slotId={slot.id} param={param} />
          ))}
        </div>
      )}
      {expanded && plugin.parameters.length === 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px', background: 'var(--bg-elevated)', fontSize: 11, color: 'var(--text-muted)' }}>
          No exposed parameters — use the Editor button to open the plugin's own interface.
        </div>
      )}
    </div>
  )
}
