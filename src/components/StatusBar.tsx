import React from 'react'
import { useStore } from '../store/useStore'

export default function StatusBar() {
  const routing         = useStore(s => s.routing)
  const bypassAll       = useStore(s => s.bypassAll)
  const slots           = useStore(s => s.slots)
  const setShowShortcuts = useStore(s => s.setShowShortcuts)
  const engineConnected = useStore(s => s.engineConnected)
  const inputDeviceName = routing.inputDeviceId
  const activePlugins = slots.filter(s => s.enabled && !s.bypassed).length
  const totalLatency = slots
    .filter(s => s.enabled && !s.bypassed)
    .reduce((acc, s) => acc + s.plugin.latency, 0)
  const latencyMs = ((totalLatency / routing.sampleRate) * 1000).toFixed(1)

  return (
    <div style={{
      height: 24,
      background: bypassAll ? 'rgba(245,200,66,0.08)' : 'var(--bg-surface)',
      borderTop: `1px solid ${bypassAll ? 'rgba(245,200,66,0.3)' : 'var(--border)'}`,
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: 16,
      flexShrink: 0,
      fontSize: 10,
      color: 'var(--text-muted)',
      fontFamily: 'var(--mono)',
    }}>
      <StatusItem
        dot={!engineConnected ? undefined : bypassAll ? 'yellow' : 'green'}
        label={!engineConnected ? 'ENGINE OFFLINE' : bypassAll ? 'BYPASS ALL' : 'ACTIVE'}
        highlight={bypassAll || !engineConnected}
      />
      <Sep />
      <StatusItem label={inputDeviceName || 'No device'} />
      <Sep />
      <StatusItem label={`${routing.sampleRate / 1000}kHz`} />
      <StatusItem label={`${routing.bufferSize} smp`} />
      <Sep />
      <StatusItem label={`${activePlugins} plugin${activePlugins !== 1 ? 's' : ''}`} />
      <StatusItem label={`${latencyMs}ms`} />
      <Sep />
      <CpuReadout />
      <div style={{ flex: 1 }} />
      <button
        onClick={() => setShowShortcuts(true)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--mono)',
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '2px 6px', borderRadius: 3,
          transition: 'color 0.1s',
        }}
      >
        <kbd style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 2, padding: '0 3px', fontSize: 9 }}>?</kbd>
        shortcuts
      </button>
    </div>
  )
}

function Sep() {
  return <div style={{ width: 1, height: 10, background: 'var(--border)' }} />
}

// Isolated CPU readout — subscribes only to cpu (updates ~30fps)
function CpuReadout() {
  const cpu = useStore(s => s.cpu)
  const pct = Math.round(cpu * 100)
  const color = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--yellow)' : 'var(--text-muted)'
  return <span style={{ color }}>CPU {pct}%</span>
}

function StatusItem({ label, dot, highlight }: { label: string; dot?: 'green' | 'yellow'; highlight?: boolean }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: highlight ? 'var(--yellow)' : 'var(--text-muted)' }}>
      {dot && (
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: dot === 'green' ? 'var(--green)' : 'var(--yellow)',
          boxShadow: dot === 'green' ? '0 0 4px var(--green)' : '0 0 4px var(--yellow)',
          display: 'inline-block',
        }} />
      )}
      {label}
    </span>
  )
}
