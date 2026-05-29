import React, { useState } from 'react'
import { useStore } from '../../store/useStore'

export default function SavePresetModal() {
  const { savePreset, setShowSavePreset, slots } = useStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const handleSave = () => {
    if (!name.trim()) return
    savePreset(name.trim(), description.trim())
  }

  return (
    <div className="modal-overlay" onClick={() => setShowSavePreset(false)}>
      <div className="modal" style={{ width: 400 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Save Preset</span>
          <div style={{ flex: 1 }} />
          <button className="btn-icon" onClick={() => setShowSavePreset(false)}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={{ padding: '16px' }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Preset Name</label>
            <input
              type="text"
              placeholder="My Voice Chain..."
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Description <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            <input
              type="text"
              placeholder="Brief description..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>

          {/* Preview of what will be saved */}
          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '8px 10px',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>Chain preview</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {slots.map((s, i) => (
                <span key={i} style={{
                  fontSize: 9, background: 'var(--bg-active)', color: s.enabled ? 'var(--text-secondary)' : 'var(--text-muted)',
                  padding: '2px 6px', borderRadius: 3, fontWeight: 500,
                }}>
                  {s.plugin.name}
                </span>
              ))}
              {slots.length === 0 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Empty chain</span>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setShowSavePreset(false)}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!name.trim()}
              style={{ opacity: name.trim() ? 1 : 0.5 }}
            >
              Save Preset
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
