import React, { useEffect, useRef, useState } from 'react'
import { api } from '../services/api.js'

const CONF_META = {
  HIGH:   { color: '#10b981', glow: 'rgba(16,185,129,0.18)',  label: 'HIGH' },
  MEDIUM: { color: '#f59e0b', glow: 'rgba(245,158,11,0.18)',  label: 'MEDIUM' },
  LOW:    { color: '#ef4444', glow: 'rgba(239,68,68,0.18)',   label: 'LOW' },
}

function qColor(score) {
  if (score >= 75) return '#10b981'
  if (score >= 50) return '#f59e0b'
  return '#ef4444'
}

function AnimatedScore({ score, color }) {
  const [val, setVal] = useState(0)
  const raf = useRef(null)
  useEffect(() => {
    let start = null
    const step = (ts) => {
      if (!start) start = ts
      const p = Math.min((ts - start) / 900, 1)
      setVal(Math.round(score * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [score])

  return (
    <div style={{
      fontSize: 42, fontWeight: 900, lineHeight: 1,
      color, fontVariantNumeric: 'tabular-nums',
      textShadow: `0 0 20px ${color}60`,
    }}>
      {val}<span style={{ fontSize: 16, fontWeight: 600, opacity: 0.7 }}>%</span>
    </div>
  )
}

function SourceBar({ s, delay = 0 }) {
  const c = qColor(s.quality_score)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setWidth(s.quality_score), delay + 80)
    return () => clearTimeout(t)
  }, [s.quality_score, delay])

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.72)', fontWeight: 600 }}>{s.label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>{s.status}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, color: c,
            background: `${c}18`, border: `1px solid ${c}30`,
            padding: '1px 6px', borderRadius: 4,
          }}>{s.quality_score}</span>
        </div>
      </div>
      <div style={{ height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${width}%`,
          background: `linear-gradient(90deg, ${c}bb, ${c})`,
          borderRadius: 3,
          transition: 'width 0.75s cubic-bezier(0.34,1.56,0.64,1)',
          boxShadow: `0 0 6px ${c}50`,
        }} />
      </div>
      {s.detail && (
        <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.3)', marginTop: 3 }}>{s.detail}</div>
      )}
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
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
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

function SignalGrid({ sources }) {
  const entries = Object.entries(sources || {})
  if (!entries.length) return null

  const statusMeta = (status) => {
    const s = (status || '').toLowerCase()
    // backend: available, degraded, incomplete, limited, no_data, unavailable
    if (s === 'available' || s === 'live' || s === 'fresh')
      return { color: '#10b981', label: 'LIVE', pulse: true }
    if (s === 'recent')
      return { color: '#60a5fa', label: 'RECENT', pulse: false }
    if (s === 'degraded' || s === 'delayed' || s === 'stale')
      return { color: '#f59e0b', label: 'DEGRADED', pulse: false }
    if (s === 'incomplete')
      return { color: '#f59e0b', label: 'PARTIAL', pulse: false }
    if (s === 'limited')
      return { color: '#60a5fa', label: 'LIMITED', pulse: false }
    if (s === 'no_data')
      return { color: '#94a3b8', label: 'NO DATA', pulse: false }
    return { color: '#ef4444', label: 'DOWN', pulse: false }
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', marginBottom: 9 }}>
        LIVE SIGNAL STATUS
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {entries.map(([key, s]) => {
          const { color, label, pulse } = statusMeta(s.status)
          return (
            <div key={key} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', borderRadius: 8,
              background: `${color}0a`,
              border: `1px solid ${color}22`,
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: color, flexShrink: 0,
                boxShadow: `0 0 6px ${color}`,
                animation: pulse ? 'blink 1.4s ease-in-out infinite' : 'none',
              }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.75)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{s.label}</div>
                <div style={{ fontSize: 9, color, fontWeight: 700, letterSpacing: '0.05em' }}>{label}</div>
              </div>
              <div style={{
                fontSize: 9, fontWeight: 800, color: color,
                background: `${color}18`, border: `1px solid ${color}30`,
                padding: '1px 5px', borderRadius: 4, flexShrink: 0,
              }}>{s.quality_score}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RefreshCountdown() {
  const [mins, setMins] = useState(0)
  const startRef = useRef(Date.now())

  useEffect(() => {
    const t = setInterval(() => {
      setMins(Math.floor((Date.now() - startRef.current) / 60000))
    }, 30000)
    return () => clearInterval(t)
  }, [])

  const nextIn = Math.max(0, 10 - mins)

  return (
    <div style={{
      marginTop: 10,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '7px 10px', borderRadius: 8,
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, animation: 'spin 4s linear infinite', display: 'inline-block' }}>🔄</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>
          {mins === 0 ? 'Just refreshed' : `Refreshed ${mins}m ago`}
        </span>
      </div>
      <span style={{
        fontSize: 9.5, fontWeight: 700, color: 'rgba(255,255,255,0.3)',
        background: 'rgba(255,255,255,0.05)', padding: '2px 7px', borderRadius: 5,
        border: '1px solid rgba(255,255,255,0.08)',
      }}>next in {nextIn}m</span>
    </div>
  )
}

export default function DataQualityMeter() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () => api.dataQuality()
      .then(d => { if (alive) { setData(d); setError(false) } })
      .catch(() => { if (alive) setError(true) })
    load()
    const t = setInterval(load, 10 * 60 * 1000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  if (error) return (
    <div className="panel panel-pad" style={{ flex: 1 }}>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Data quality unavailable</span>
    </div>
  )
  if (!data) return (
    <div className="panel panel-pad" style={{ flex: 1 }}>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Assessing data quality…</span>
    </div>
  )

  const cm = CONF_META[data.confidence_level] || { color: '#7c6bff', glow: 'rgba(124,107,255,0.15)', label: data.confidence_level }

  return (
    <div style={{
      flex: 1, minWidth: 280,
      borderRadius: 14,
      background: 'linear-gradient(135deg, rgba(16,24,48,0.95) 0%, rgba(10,18,38,0.98) 100%)',
      border: `1px solid ${cm.color}28`,
      overflow: 'hidden',
      boxShadow: `0 4px 28px ${cm.glow}`,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${cm.color}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: `${cm.color}07`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 3, height: 14, background: cm.color, borderRadius: 2, display: 'block' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#e8e8ff', letterSpacing: '0.04em' }}>
            DATA QUALITY & CONFIDENCE
          </span>
          <HelpTip text="Shows how fresh and reliable the news, weather, and supplier signals are. High means all sources are live and recent — Low confidence may affect the accuracy of risk predictions." />
        </div>
        <div style={{
          fontSize: 10, fontWeight: 800, color: cm.color,
          background: `${cm.color}18`, border: `1px solid ${cm.color}40`,
          padding: '3px 10px', borderRadius: 20, letterSpacing: '0.06em',
        }}>{cm.label}</div>
      </div>

      {/* Score + description */}
      <div style={{ padding: '16px 18px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
          <AnimatedScore score={data.overall_quality_score} color={cm.color} />
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6 }}>
            {data.confidence_description}
          </div>
        </div>

        {/* Sources accordion */}
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, padding: '5px 10px', cursor: 'pointer',
            fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.55)',
            marginBottom: expanded ? 12 : 0, transition: 'background 0.15s',
          }}
        >
          <span style={{
            display: 'inline-block', fontSize: 10,
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 0.2s',
          }}>▾</span>
          Data Sources ({Object.keys(data.sources || {}).length})
        </button>

        {expanded && (
          <div style={{ marginTop: 4 }}>
            {Object.entries(data.sources || {}).map(([key, s], i) => (
              <SourceBar key={key} s={s} delay={i * 80} />
            ))}
          </div>
        )}

        {/* Transparency notes */}
        {data.warnings?.length > 0 && (
          <div style={{
            marginTop: 12, paddingTop: 10,
            borderTop: '1px solid rgba(255,255,255,0.07)',
          }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', marginBottom: 6 }}>
              TRANSPARENCY NOTES
            </div>
            {data.warnings.map((w, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'flex-start' }}>
                <span style={{ color: cm.color, fontSize: 10, flexShrink: 0 }}>•</span>
                <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.55 }}>{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* Live signal grid */}
        <SignalGrid sources={data.sources} />

        {/* Refresh countdown */}
        <RefreshCountdown />
      </div>
    </div>
  )
}
