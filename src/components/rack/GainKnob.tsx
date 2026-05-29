import React, { useRef, useState } from 'react'

interface Props {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  label?: string
}

export default function GainKnob({ value, onChange, min = -24, max = 24, label = 'Gain' }: Props) {
  const [dragging, setDragging] = useState(false)
  const startY = useRef(0)
  const startVal = useRef(0)

  const onMouseDown = (e: React.MouseEvent) => {
    setDragging(true)
    startY.current = e.clientY
    startVal.current = value
    e.preventDefault()
  }

  React.useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const delta = (startY.current - e.clientY) * 0.4
      const newVal = Math.round(Math.max(min, Math.min(max, startVal.current + delta)))
      onChange(newVal)
    }
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [dragging, min, max, onChange])

  const pct = (value - min) / (max - min)
  const startAngle = -135
  const endAngle = 135
  const angle = startAngle + pct * (endAngle - startAngle)
  const rad = (angle * Math.PI) / 180
  const cx = 16, cy = 16, r = 11
  const nx = cx + r * Math.sin(rad)
  const ny = cy - r * Math.cos(rad)

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: dragging ? 'ns-resize' : 'pointer', flexShrink: 0 }}
      onMouseDown={onMouseDown}
      title={`${label}: ${value > 0 ? '+' : ''}${value} dB`}
    >
      <svg width="32" height="32" viewBox="0 0 32 32">
        {/* Track arc */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-elevated)" strokeWidth="3" />
        {/* Value arc */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={value > 0 ? 'var(--accent)' : value < -18 ? 'var(--red)' : 'var(--accent)'}
          strokeWidth="3"
          strokeDasharray={`${pct * 2 * Math.PI * r} ${2 * Math.PI * r}`}
          strokeDashoffset={`${2 * Math.PI * r * 0.625}`}
          strokeLinecap="round"
          opacity="0.85"
        />
        {/* Knob body */}
        <circle cx={cx} cy={cy} r={8} fill="var(--bg-elevated)" stroke="var(--border-light)" strokeWidth="1.5" />
        {/* Indicator dot */}
        <circle cx={nx} cy={ny} r={1.8} fill="var(--accent)" />
      </svg>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontSize: 9, color: 'var(--text-secondary)', fontFamily: 'var(--mono)' }}>
          {value > 0 ? '+' : ''}{value}
        </div>
      </div>
    </div>
  )
}
