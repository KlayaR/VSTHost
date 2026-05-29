import React from 'react'
import { createPortal } from 'react-dom'

/**
 * A single global tooltip rendered into document.body, so it is never clipped
 * by ancestor `overflow: hidden` or scroll containers. Any element with a
 * `data-tip` attribute triggers it via event delegation.
 */
export default function TooltipLayer() {
  const [tip, setTip] = React.useState<{ text: string; x: number; y: number } | null>(null)

  React.useEffect(() => {
    const findTip = (el: EventTarget | null): HTMLElement | null => {
      let node = el as HTMLElement | null
      while (node && node !== document.body) {
        if (node.dataset && node.dataset.tip) return node
        node = node.parentElement
      }
      return null
    }

    const onOver = (e: MouseEvent) => {
      const el = findTip(e.target)
      if (el) {
        const r = el.getBoundingClientRect()
        setTip({ text: el.dataset.tip!, x: r.left + r.width / 2, y: r.top })
      }
    }
    const onOut = (e: MouseEvent) => {
      if (findTip(e.target)) setTip(null)
    }

    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
    }
  }, [])

  if (!tip) return null
  return createPortal(
    <div style={{
      position: 'fixed',
      left: tip.x,
      top: tip.y - 8,
      transform: 'translate(-50%, -100%)',
      background: 'var(--bg-active)',
      border: '1px solid var(--border-light)',
      color: 'var(--text-primary)',
      fontSize: 11,
      padding: '3px 8px',
      borderRadius: 5,
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      zIndex: 1000,
      boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
    }}>
      {tip.text}
    </div>,
    document.body
  )
}
