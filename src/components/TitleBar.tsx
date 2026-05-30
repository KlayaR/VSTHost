import React from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useStore } from '../store/useStore'

const appWindow = (() => {
  try { return getCurrentWindow() } catch { return null }
})()

export default function TitleBar() {
  const bypassAll       = useStore(s => s.bypassAll)
  const activePresetId  = useStore(s => s.activePresetId)
  const presets         = useStore(s => s.presets)
  const presetModified  = useStore(s => s.presetModified)
  const updateAvailable = useStore(s => s.updateAvailable)
  const activePreset = presets.find(p => p.id === activePresetId)

  return (
    <div
      data-tauri-drag-region
      style={{
        height: 36,
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        flexShrink: 0,
        gap: 10,
      }}
    >
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <VstIcon />
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>VSTHost</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>v1.3.0</span>
      </div>

      <div data-tauri-drag-region style={{ flex: 1 }} />

      {/* Active preset pill */}
      {activePreset && (
        <div style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '2px 10px',
          fontSize: 11,
          color: 'var(--text-secondary)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: bypassAll ? 'var(--yellow)' : 'var(--green)', display: 'inline-block', boxShadow: bypassAll ? '0 0 6px var(--yellow)' : '0 0 6px var(--green)' }} />
          {activePreset.name}
          {presetModified && <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>· modified</span>}
        </div>
      )}

      {bypassAll && (
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--yellow)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          BYPASS ALL
        </div>
      )}

      <div data-tauri-drag-region style={{ flex: 1 }} />

      {/* Update banner */}
      {updateAvailable && (
        <a
          href={`https://github.com/KlayaR/VSTHost/releases/tag/${updateAvailable}`}
          target="_blank" rel="noreferrer"
          style={{
            fontSize: 10, padding: '2px 10px', borderRadius: 4, textDecoration: 'none',
            background: 'rgba(91,140,255,0.15)', border: '1px solid var(--accent)',
            color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap',
          }}
        >
          ↑ {updateAvailable} available
        </a>
      )}

      {/* Window controls */}
      <div style={{ display: 'flex', gap: 4 }}>
        <WinBtn hoverColor="#ffbb00" onClick={() => appWindow?.minimize()}>
          <svg width="10" height="2" viewBox="0 0 10 2"><rect width="10" height="2" fill="currentColor" /></svg>
        </WinBtn>
        <WinBtn hoverColor="#00cc44" onClick={() => appWindow?.toggleMaximize()}>
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </WinBtn>
        <WinBtn hoverColor="var(--red)" onClick={() => appWindow?.close()}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" />
            <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </WinBtn>
      </div>
    </div>
  )
}

function WinBtn({ children, hoverColor, onClick }: { children: React.ReactNode, hoverColor: string, onClick?: () => void }) {
  const [hov, setHov] = React.useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 26, height: 22,
        borderRadius: 4,
        background: hov ? 'var(--bg-hover)' : 'transparent',
        border: 'none',
        color: hov ? hoverColor : 'var(--text-muted)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        transition: 'color 0.1s, background 0.1s',
      }}
    >
      {children}
    </button>
  )
}

function VstIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect width="18" height="18" rx="4" fill="var(--accent)" opacity="0.9" />
      <path d="M4 6 L7 12 L10 6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="12" y1="5" x2="14" y2="13" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
