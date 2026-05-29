import React from 'react'

interface Props {
  level: number  // 0–1
  height?: number
  width?: number
  vertical?: boolean
  segments?: number
  label?: string
  peak?: boolean
}

export default function LevelMeter({ level, height = 80, width = 8, vertical = true, label, peak = true }: Props) {
  const [peakLevel, setPeakLevel] = React.useState(0)
  const peakTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    if (level > peakLevel) {
      setPeakLevel(level)
      if (peakTimer.current) clearTimeout(peakTimer.current)
      peakTimer.current = setTimeout(() => setPeakLevel(0), 1800)
    }
  }, [level, peakLevel])

  const getColor = (lvl: number) => {
    if (lvl > 0.9) return 'var(--red)'
    if (lvl > 0.7) return 'var(--yellow)'
    return 'var(--green)'
  }

  const segCount = 20
  const segs = Array.from({ length: segCount }, (_, i) => {
    const threshold = (i + 1) / segCount
    const lit = level >= threshold
    let color = '#3ddc84'
    if (threshold > 0.9) color = '#ff5555'
    else if (threshold > 0.7) color = '#f5c842'
    return { lit, color, threshold }
  })

  if (vertical) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
        {label && <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</span>}
        <div style={{ position: 'relative', width, height }}>
          {/* Background track */}
          <div style={{ width, height, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden', position: 'relative', border: '1px solid var(--border)' }}>
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: `${level * 100}%`,
              background: `linear-gradient(to top, var(--green) 0%, var(--yellow) 70%, var(--red) 100%)`,
              transition: 'height 0.05s ease-out',
              borderRadius: 1,
            }} />
            {/* Segment overlay */}
            {segs.map((_, i) => (
              <div key={i} style={{
                position: 'absolute',
                left: 0, right: 0,
                height: 1,
                bottom: `${(i / segCount) * 100}%`,
                background: 'var(--bg-elevated)',
                opacity: 0.5,
              }} />
            ))}
          </div>
          {/* Peak indicator */}
          {peak && peakLevel > 0.05 && (
            <div style={{
              position: 'absolute',
              left: 0, right: 0,
              height: 2,
              bottom: `${peakLevel * (height - 2)}px`,
              background: getColor(peakLevel),
              borderRadius: 1,
              boxShadow: `0 0 4px ${getColor(peakLevel)}`,
              transition: 'bottom 0.05s',
            }} />
          )}
        </div>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
          {level > 0 ? `${Math.round((level - 1) * 60)}` : '-∞'}
        </span>
      </div>
    )
  }

  // Horizontal
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
            {level > 0 ? `${Math.round((level - 1) * 60)} dB` : '-∞'}
          </span>
        </div>
      )}
      <div style={{ position: 'relative', height, width: '100%', background: 'var(--bg-elevated)', borderRadius: 3, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: `${level * 100}%`,
          background: `linear-gradient(to right, var(--green) 0%, var(--yellow) 70%, var(--red) 95%)`,
          transition: 'width 0.04s ease-out',
        }} />
        {peak && peakLevel > 0.05 && (
          <div style={{
            position: 'absolute',
            top: 0, bottom: 0,
            width: 2,
            left: `${peakLevel * 100}%`,
            background: getColor(peakLevel),
            boxShadow: `0 0 4px ${getColor(peakLevel)}`,
          }} />
        )}
      </div>
    </div>
  )
}
