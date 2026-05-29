import React from 'react'
import { useStore } from '../../store/useStore'
import type { PluginParameter } from '../../types'

interface Props {
  slotId: string
  param: PluginParameter
}

export default function ParamSlider({ slotId, param }: Props) {
  const { updateParam } = useStore()
  const pct = ((param.value - param.min) / (param.max - param.min)) * 100

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 500 }}>{param.name}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
          {param.value > 0 && param.unit === 'dB' ? '+' : ''}{typeof param.value === 'number' && !Number.isInteger(param.value) ? param.value.toFixed(1) : param.value}
          <span style={{ fontSize: 9, opacity: 0.7 }}> {param.unit}</span>
        </span>
      </div>
      <div style={{ position: 'relative', height: 4, borderRadius: 2, background: 'var(--bg-base)', cursor: 'pointer' }}>
        <div style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: `${pct}%`,
          background: 'var(--accent)',
          borderRadius: 2,
          opacity: 0.8,
        }} />
        <input
          type="range"
          min={param.min}
          max={param.max}
          step={(param.max - param.min) / 200}
          value={param.value}
          onChange={(e) => updateParam(slotId, param.id, parseFloat(e.target.value))}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: 0,
            cursor: 'pointer',
            margin: 0,
          }}
        />
        <div style={{
          position: 'absolute',
          left: `${pct}%`,
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 10, height: 10,
          borderRadius: '50%',
          background: 'var(--accent)',
          border: '2px solid var(--bg-elevated)',
          pointerEvents: 'none',
          boxShadow: '0 0 4px var(--accent-glow)',
        }} />
      </div>
    </div>
  )
}
