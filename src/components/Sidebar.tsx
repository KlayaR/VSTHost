import React from 'react'
import { useStore } from '../store/useStore'
import type { NavSection } from '../types'

const NAV: { id: NavSection; label: string; icon: React.ReactNode }[] = [
  {
    id: 'studio',
    label: 'Studio',
    icon: (
      <svg width="19" height="19" viewBox="0 0 19 19" fill="none">
        <rect x="2.5" y="3" width="14" height="3" rx="1" stroke="currentColor" strokeWidth="1.4" />
        <rect x="2.5" y="8" width="14" height="3" rx="1" stroke="currentColor" strokeWidth="1.4" />
        <rect x="2.5" y="13" width="14" height="3" rx="1" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="13" cy="4.5" r="1" fill="currentColor" />
        <circle cx="13" cy="9.5" r="1" fill="currentColor" />
        <circle cx="13" cy="14.5" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <svg width="19" height="19" viewBox="0 0 19 19" fill="none">
        <circle cx="9.5" cy="9.5" r="2.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M9.5 2.5v1.5M9.5 15v1.5M2.5 9.5h1.5M15 9.5h1.5M4.4 4.4l1.06 1.06M13.5 13.5l1.06 1.06M14.6 4.4l-1.06 1.06M5.5 13.5l-1.06 1.06" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
]

export default function Sidebar() {
  const { activeSection, setActiveSection, theme, toggleTheme } = useStore()

  return (
    <div style={{
      width: 64,
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '10px 0',
      gap: 6,
      flexShrink: 0,
    }}>
      {NAV.map(item => {
        const active = activeSection === item.id
        return (
          <button
            key={item.id}
            onClick={() => setActiveSection(item.id)}
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              border: 'none',
              background: active ? 'var(--accent-glow)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              cursor: 'pointer',
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            {item.icon}
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.03em' }}>{item.label}</span>
          </button>
        )
      })}

      <div style={{ flex: 1 }} />

      <button
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        style={{
          width: 48, height: 40,
          borderRadius: 10,
          border: 'none',
          background: 'transparent',
          color: 'var(--text-muted)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          transition: 'color 0.12s',
        }}
      >
        {theme === 'dark' ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M13.5 10.5A6 6 0 016 3a6 6 0 100 10 6.1 6.1 0 007.5-2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </div>
  )
}
