import React from 'react'
import { useStore } from '../../store/useStore'

const SHORTCUTS = [
  { keys: ['Ctrl', 'S'], action: 'Save Preset' },
  { keys: ['Space'], action: 'Toggle Bypass All' },
  { keys: ['?'], action: 'Show keyboard shortcuts' },
  { keys: ['Esc'], action: 'Close modal / dismiss' },
]

export default function ShortcutsModal() {
  const { setShowShortcuts } = useStore()

  return (
    <div className="modal-overlay" onClick={() => setShowShortcuts(false)}>
      <div className="modal" style={{ width: 340 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Keyboard Shortcuts</span>
          <div style={{ flex: 1 }} />
          <button className="btn-icon" onClick={() => setShowShortcuts(false)}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div style={{ padding: '12px 0' }}>
          {SHORTCUTS.map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 16px',
              borderBottom: i < SHORTCUTS.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.action}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {s.keys.map((k, j) => (
                  <kbd key={j} style={{
                    background: 'var(--bg-active)',
                    border: '1px solid var(--border-light)',
                    borderBottom: '2px solid var(--border-light)',
                    borderRadius: 4,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontFamily: 'var(--mono)',
                    color: 'var(--text-primary)',
                  }}>
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
