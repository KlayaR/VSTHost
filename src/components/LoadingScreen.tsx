import { useStore } from '../store/useStore'

/**
 * Full-window startup overlay. Shows what the app is doing while the audio
 * engine starts and the saved chain loads. Audio is muted by the engine during
 * this phase, so there's no feedback/larsen while plugins initialise.
 */
export default function LoadingScreen() {
  const appLoading      = useStore(s => s.appLoading)
  const phase           = useStore(s => s.loadingPhase)
  const detail          = useStore(s => s.loadingDetail)
  const progress        = useStore(s => s.loadingProgress)

  if (!appLoading) return null

  const indeterminate = progress < 0
  const pct = Math.max(0, Math.min(1, progress)) * 100

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'var(--bg-base, #0e1116)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 22, userSelect: 'none',
    }}>
      {/* Logo / wordmark */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: 'linear-gradient(135deg, var(--accent, #5b8cff), #3a5bd9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 24px rgba(91,140,255,0.45)',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M3 12h3l2-6 4 14 3-9 2 3h4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.02em', color: 'var(--text-primary, #f1f3f8)' }}>
          VSTHost
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ width: 320, maxWidth: '70vw' }}>
        <div style={{
          height: 6, borderRadius: 4, overflow: 'hidden',
          background: 'var(--bg-elevated, #1b1f29)',
          border: '1px solid var(--border, #2a3040)',
          position: 'relative',
        }}>
          {indeterminate ? (
            <div style={{
              position: 'absolute', top: 0, bottom: 0, width: '35%',
              background: 'var(--accent, #5b8cff)', borderRadius: 4,
              animation: 'vh-indeterminate 1.1s ease-in-out infinite',
            }} />
          ) : (
            <div style={{
              height: '100%', width: `${pct}%`,
              background: 'var(--accent, #5b8cff)', borderRadius: 4,
              transition: 'width 0.25s ease',
            }} />
          )}
        </div>

        {/* Phase + detail */}
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #f1f3f8)' }}>{phase}</div>
          {detail && (
            <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text-muted, #8b93a7)', fontFamily: 'var(--mono, monospace)' }}>
              {detail}
            </div>
          )}
        </div>
      </div>

      <div style={{ fontSize: 10.5, color: 'var(--text-muted, #8b93a7)' }}>
        Audio is muted while loading…
      </div>

      <style>{`
        @keyframes vh-indeterminate {
          0%   { left: -35%; }
          100% { left: 100%; }
        }
      `}</style>
    </div>
  )
}
