import React, { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

export function InfoTooltip({ title, description }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, above: false })
  const btnRef = useRef(null)

  const openTooltip = useCallback(() => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const TW = 300
    const spaceRight = window.innerWidth - rect.left
    const left = spaceRight >= TW + 12 ? rect.left : Math.max(8, rect.right - TW)
    const spaceBelow = window.innerHeight - rect.bottom
    const above = spaceBelow < 170
    setPos({ top: above ? rect.top - 6 : rect.bottom + 6, left, above })
    setOpen(true)
  }, [])

  return (
    <>
      <span style={{ display: 'inline-block' }}>
        <button
          ref={btnRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); open ? setOpen(false) : openTooltip() }}
          onMouseEnter={openTooltip}
          onMouseLeave={() => setOpen(false)}
          style={{
            width: 18, height: 18, borderRadius: '50%',
            background: 'rgba(124,107,255,0.15)',
            border: '1px solid rgba(124,107,255,0.4)',
            color: 'var(--primary)',
            fontSize: 10, fontWeight: 700, cursor: 'help',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: 0, lineHeight: 1,
          }}
          aria-label={`Help: ${title}`}
        >
          ?
        </button>
      </span>
      {open && createPortal(
        <div
          style={{
            position: 'fixed',
            top: pos.above ? undefined : pos.top,
            bottom: pos.above ? window.innerHeight - pos.top : undefined,
            left: pos.left,
            width: 300,
            padding: '14px 16px',
            borderRadius: 10,
            background: 'rgba(6,9,24,0.98)',
            border: '1px solid rgba(124,107,255,0.45)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.75)',
            zIndex: 99999,
            pointerEvents: 'auto',
          }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa', marginBottom: 8 }}>{title}</div>
          <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.65 }}>{description}</div>
        </div>,
        document.body
      )}
    </>
  )
}

export function Tag({ children, color = 'var(--primary)', style = {} }) {
  const bgMap = {
    'var(--primary)':  'rgba(124, 107, 255, 0.15)',
    'var(--success)':  'rgba(45, 212, 191, 0.15)',
    'var(--warning)':  'rgba(245, 158, 11, 0.15)',
    'var(--danger)':   'rgba(255, 107, 107, 0.15)',
    'var(--info)':     'rgba(96, 165, 250, 0.15)',
    'var(--purple)':   'rgba(192, 132, 252, 0.15)',
    'var(--pink)':     'rgba(244, 114, 182, 0.15)',
    'var(--text-dim)': 'rgba(255, 255, 255, 0.08)',
    'var(--text-sec)': 'rgba(255, 255, 255, 0.08)',
    'var(--good)':     'rgba(45, 212, 191, 0.15)',
    'var(--acid)':     'rgba(124, 107, 255, 0.15)',
    'var(--signal)':   'rgba(96, 165, 250, 0.15)',
    'var(--alert)':    'rgba(255, 107, 107, 0.15)',
    'var(--warn)':     'rgba(245, 158, 11, 0.15)',
    'var(--dissent)':  'rgba(192, 132, 252, 0.15)',
    'var(--cascade)':  'rgba(244, 114, 182, 0.15)',
  }
  const bg = bgMap[color] || 'rgba(255, 255, 255, 0.08)'
  return (
    <span
      className="tag"
      style={{
        color: color,
        background: bg,
        border: `1px solid ${color}`,
        ...style
      }}
    >
      {children}
    </span>
  )
}

export function Eyebrow({ children, accent = 'var(--text-dim)' }) {
  return (
    <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 18, height: 1, background: accent }} />
      <span>{children}</span>
    </div>
  )
}

export function PanelHeader({ label, accent, right, collapsed, onToggle }) {
  return (
    <div
      className="panel-header"
      style={{
        borderBottomColor: accent ? `${accent}33` : 'var(--glass-border)',
        cursor: onToggle ? 'pointer' : 'default',
        userSelect: 'none',
      }}
      onClick={onToggle}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {accent && <span style={{ width: 4, height: 14, background: accent }} />}
        <span className="label" style={{ color: accent || 'var(--text-pri)' }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {right && <div onClick={e => e.stopPropagation()}>{right}</div>}
        {onToggle && (
          <span style={{
            fontSize: 14, color: 'rgba(255,255,255,0.45)',
            display: 'inline-block',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
            lineHeight: 1,
          }}>▾</span>
        )}
      </div>
    </div>
  )
}

export function Stat({ label, value, color = 'var(--text-pri)', size = 'lg' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span className="eyebrow">{label}</span>
      <span className={`digits digits-${size}`} style={{ color }}>{value}</span>
    </div>
  )
}

export function tierColor(tier) {
  return {
    Critical: 'var(--danger)',
    High:     '#FB923C',
    Medium:   'var(--warning)',
    Low:      'var(--success)',
  }[tier] || 'var(--text-sec)'
}

export function severityColor(s) {
  if (s >= 9) return 'var(--danger)'
  if (s >= 7) return '#FB923C'
  if (s >= 5) return 'var(--warning)'
  return 'var(--success)'
}
