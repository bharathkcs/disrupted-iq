import React, { useEffect, useRef, useState } from 'react'
import { api } from '../services/api.js'

const RATING_META = {
  STRONG:   { color: '#10b981', glow: 'rgba(16,185,129,0.2)',  label: 'Strong' },
  MODERATE: { color: '#f59e0b', glow: 'rgba(245,158,11,0.2)',  label: 'Moderate' },
  WEAK:     { color: '#ef4444', glow: 'rgba(239,68,68,0.2)',   label: 'Weak' },
}

const COMPONENT_META = {
  supplier_diversification: { label: 'Supplier Diversification', icon: '🏭', color: '#7c6bff' },
  buffer_stock:             { label: 'Buffer Stock Levels',      icon: '📦', color: '#2dd4bf' },
  route_diversity:          { label: 'Route / Geo Diversity',    icon: '🌐', color: '#60a5fa' },
  recovery_capability:      { label: 'Recovery Capability',      icon: '⚡', color: '#c084fc' },
}

function ScoreDial({ score, color }) {
  const [animated, setAnimated] = useState(0)
  const raf = useRef(null)

  useEffect(() => {
    let start = null
    const duration = 1100
    const step = (ts) => {
      if (!start) start = ts
      const p = Math.min((ts - start) / duration, 1)
      const ease = 1 - Math.pow(1 - p, 3)
      setAnimated(score * ease)
      if (p < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [score])

  const size = 120
  const r = 48
  const circ = 2 * Math.PI * r
  const dash = (animated / 100) * circ

  return (
    <svg width={size} height={size} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="res-dial-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor="#2dd4bf" />
        </linearGradient>
      </defs>
      <circle cx={60} cy={60} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" />
      <circle
        cx={60} cy={60} r={r}
        fill="none" stroke="url(#res-dial-grad)" strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        style={{ transform: 'rotate(-90deg)', transformOrigin: '60px 60px' }}
      />
      <text x={60} y={56} textAnchor="middle" fontSize="24" fontWeight="900" fill="#fff">
        {Math.round(animated)}
      </text>
      <text x={60} y={70} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.4)" fontWeight="600" letterSpacing="1">
        / 100
      </text>
    </svg>
  )
}

function ComponentBar({ id, value, delay = 0 }) {
  const meta = COMPONENT_META[id] || { label: id, icon: '•', color: '#7c6bff' }
  const pct = Math.min(100, (value / 25) * 100)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setWidth(pct), delay + 100)
    return () => clearTimeout(t)
  }, [pct, delay])

  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12 }}>{meta.icon}</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>{meta.label}</span>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, color: meta.color,
          background: `${meta.color}15`, border: `1px solid ${meta.color}30`,
          padding: '1px 6px', borderRadius: 4,
        }}>{value}/25</span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.07)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${width}%`,
          background: `linear-gradient(90deg, ${meta.color}cc, ${meta.color})`,
          borderRadius: 4,
          transition: 'width 0.8s cubic-bezier(0.34,1.56,0.64,1)',
          boxShadow: `0 0 8px ${meta.color}50`,
        }} />
      </div>
    </div>
  )
}

function HelpTip({ text }) {
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)

  const show = () => {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 8, left: Math.max(8, r.right - 240) })
  }
  const hide = () => setPos(null)

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={btnRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={e => { e.stopPropagation(); pos ? hide() : show() }}
        style={{
          width: 16, height: 16, borderRadius: '50%',
          background: 'rgba(124,107,255,0.15)', border: '1px solid rgba(124,107,255,0.4)',
          color: '#7c6bff', fontSize: 9, fontWeight: 700, cursor: 'help',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: 0,
        }}
      >?</button>
      {pos && (
        <div style={{
          position: 'fixed', top: pos.top, left: pos.left,
          width: 240, padding: '11px 14px', borderRadius: 10,
          background: 'rgba(4,6,20,0.97)', border: '1px solid rgba(124,107,255,0.45)',
          boxShadow: '0 12px 36px rgba(0,0,0,0.75)', zIndex: 9999,
          fontSize: 11.5, color: 'rgba(255,255,255,0.85)', lineHeight: 1.65,
          textAlign: 'left', pointerEvents: 'none',
        }}>{text}</div>
      )}
    </span>
  )
}

export default function ResilienceScore() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () => api.resilienceScore()
      .then(d => { if (alive) { setData(d); setError(false) } })
      .catch(() => { if (alive) setError(true) })
    load()
    const t = setInterval(load, 5 * 60 * 1000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  if (error) return (
    <div className="panel panel-pad" style={{ flex: 2 }}>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Resilience score unavailable</span>
    </div>
  )
  if (!data) return (
    <div className="panel panel-pad" style={{ flex: 2 }}>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Calculating resilience…</span>
    </div>
  )

  const rm = RATING_META[data.rating] || { color: '#7c6bff', glow: 'rgba(124,107,255,0.15)', label: data.rating }
  const trendColor = data.trend === 'improving' ? '#10b981' : data.trend === 'declining' ? '#ef4444' : '#94a3b8'
  const trendIcon = data.trend === 'improving' ? '↑' : data.trend === 'declining' ? '↓' : '→'

  return (
    <div style={{
      flex: 2, minWidth: 320,
      borderRadius: 14,
      background: 'linear-gradient(135deg, rgba(16,24,48,0.95) 0%, rgba(10,18,38,0.98) 100%)',
      border: `1px solid ${rm.color}28`,
      overflow: 'hidden',
      boxShadow: `0 4px 28px ${rm.glow}`,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${rm.color}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: `${rm.color}07`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 3, height: 14, background: rm.color, borderRadius: 2, display: 'block' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#e8e8ff', letterSpacing: '0.04em' }}>
            SUPPLY CHAIN RESILIENCE SCORE
          </span>
          <HelpTip text="A 0–100 score measuring how well your supply chain can absorb and recover from disruptions. Built from supplier diversity, buffer stock, geographic spread, and recovery capability." />
        </div>
        <div style={{
          fontSize: 10, fontWeight: 700, color: rm.color,
          background: `${rm.color}15`, border: `1px solid ${rm.color}35`,
          padding: '3px 10px', borderRadius: 20,
        }}>pre-disruption</div>
      </div>

      {/* Body */}
      <div style={{ padding: '16px 18px', display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <ScoreDial score={data.resilience_score} color={rm.color} />
          <div style={{ fontSize: 13, fontWeight: 800, color: rm.color, letterSpacing: '0.06em' }}>
            {rm.label}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 13, color: trendColor }}>{trendIcon}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>{data.trend}</span>
          </div>
          <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.3)', textAlign: 'center', lineHeight: 1.6 }}>
            {data.metrics?.supplier_count} suppliers<br />{data.metrics?.distinct_zones} zones
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 200 }}>
          {Object.entries(data.components).map(([id, value], i) => (
            <ComponentBar key={id} id={id} value={value} delay={i * 100} />
          ))}
        </div>
      </div>

      {/* Recommendations */}
      {data.recommendations?.length > 0 && (
        <div style={{
          margin: '0 16px 14px',
          padding: '10px 12px', borderRadius: 10,
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid rgba(255,255,255,0.07)',
        }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', marginBottom: 7 }}>
            RECOMMENDATIONS
          </div>
          {data.recommendations.map((rec, i) => (
            <div key={i} style={{ display: 'flex', gap: 7, marginBottom: 5, alignItems: 'flex-start' }}>
              <span style={{ color: '#7c6bff', fontSize: 11, flexShrink: 0, marginTop: 1 }}>›</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: 1.55 }}>{rec}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
