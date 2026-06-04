import React, { useEffect, useRef, useState } from 'react'
import { api } from '../services/api.js'
import { PanelHeader, InfoTooltip } from './ui.jsx'

// ── Shared meta tables ────────────────────────────────────────────────────────

const TYPE_META = {
  Cyclone:      { icon: '🌀', tag: 'IMD Alert',        tagColor: '#ef4444', durationDefault: '48–72 h' },
  Strike:       { icon: '⛔', tag: 'Labour News',       tagColor: '#f59e0b', durationDefault: '24–48 h' },
  Power:        { icon: '⚡', tag: 'Grid Notice',       tagColor: '#f97316', durationDefault: '7–10 days' },
  Port:         { icon: '🚢', tag: 'Port Disruption',   tagColor: '#f59e0b', durationDefault: '2–5 days' },
  Geopolitical: { icon: '🌐', tag: 'Policy Alert',      tagColor: '#f97316', durationDefault: '7–14 days' },
  Custom:       { icon: '📋', tag: 'Custom Event',      tagColor: '#60a5fa', durationDefault: '1–7 days' },
  Flooding:     { icon: '🌧️', tag: 'Flood Alert',       tagColor: '#ef4444', durationDefault: '2–4 days' },
  Earthquake:   { icon: '🏔️', tag: 'Seismic Alert',    tagColor: '#ef4444', durationDefault: '3–7 days' },
  Pandemic:     { icon: '🦠', tag: 'Health Advisory',   tagColor: '#f97316', durationDefault: '14–30 days' },
  Fire:         { icon: '🔥', tag: 'Fire Alert',        tagColor: '#ef4444', durationDefault: '1–3 days' },
}

const SIGNAL_META = {
  live_news:       { label: 'Live News',        color: '#f43f5e', bg: 'rgba(244,63,94,0.10)',   border: 'rgba(244,63,94,0.30)',   icon: '📡' },
  weather_alert:   { label: 'Weather Signal',   color: '#38bdf8', bg: 'rgba(56,189,248,0.09)',  border: 'rgba(56,189,248,0.28)',  icon: '🌩️' },
  geo_political:   { label: 'Geo-Political',    color: '#a78bfa', bg: 'rgba(167,139,250,0.09)', border: 'rgba(167,139,250,0.28)', icon: '🌐' },
  category_risk:   { label: 'Tier-2 SPOF',     color: '#fb923c', bg: 'rgba(251,146,60,0.09)',  border: 'rgba(251,146,60,0.28)',  icon: '🔗' },
  supply_pressure: { label: 'Supply Pressure',  color: '#facc15', bg: 'rgba(250,204,21,0.09)',  border: 'rgba(250,204,21,0.28)',  icon: '📦' },
}

function typeMeta(type) {
  return TYPE_META[type] || { icon: '📌', tag: 'Event', tagColor: '#60a5fa', durationDefault: '1–7 days' }
}

function sevColor(sev) {
  if (sev >= 8) return '#ef4444'
  if (sev >= 6) return '#f59e0b'
  return '#60a5fa'
}
function sevLabel(sev) {
  if (sev >= 8) return 'High'
  if (sev >= 6) return 'Medium'
  return 'Low'
}
function sevBg(sev) {
  if (sev >= 8) return 'rgba(239,68,68,0.1)'
  if (sev >= 6) return 'rgba(245,158,11,0.1)'
  return 'rgba(96,165,250,0.1)'
}

function affectedSuppliers(scenario, suppliers) {
  if (!suppliers || suppliers.length === 0) return []
  const loc     = (scenario.location || '').toLowerCase()
  const matched = suppliers.filter(s =>
    (s.zone || '').toLowerCase().includes(loc) ||
    loc.includes((s.zone || '').toLowerCase()),
  )
  return matched.length > 0 ? matched : suppliers.slice(0, Math.min(3, suppliers.length))
}

function estimatedImpact(severity) {
  return Math.round(severity * 3.5 + 4)
}

// ── My Scenarios card ─────────────────────────────────────────────────────────

function ScenarioCard({ scenario, index, suppliers, loading, onTrigger, elapsed }) {
  const meta      = typeMeta(scenario.type)
  const sc        = sevColor(scenario.severity)
  const bg        = sevBg(scenario.severity)
  const affected  = affectedSuppliers(scenario, suppliers)
  const impact    = estimatedImpact(scenario.severity)
  const isLoading = loading === scenario.id

  return (
    <div style={{
      borderRadius: 14, overflow: 'hidden',
      border: `1px solid ${sc}30`,
      background: `linear-gradient(160deg, ${bg} 0%, rgba(8,11,30,0.6) 60%)`,
      boxShadow: `0 4px 24px ${sc}10`,
      transition: 'box-shadow 0.2s, border-color 0.2s',
    }}
    onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 8px 32px ${sc}28`; e.currentTarget.style.borderColor = `${sc}55` }}
    onMouseLeave={e => { e.currentTarget.style.boxShadow = `0 4px 24px ${sc}10`; e.currentTarget.style.borderColor = `${sc}30` }}
    >
      <div style={{ height: 3, background: `linear-gradient(90deg, ${sc}, ${sc}55)`, width: `${scenario.severity * 10}%` }} />
      <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: `${sc}18`, border: `1.5px solid ${sc}35`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
            boxShadow: `0 2px 12px ${sc}20`,
          }}>{meta.icon}</div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.3 }}>{scenario.name}</span>
                  {scenario.is_seeded && (
                    <span style={{
                      fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                      background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.45)',
                      color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0,
                    }}>Suggested</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>📍 {scenario.location}</span>
                  <span style={{
                    fontSize: 9, padding: '2px 7px', borderRadius: 20, fontWeight: 700,
                    background: `${meta.tagColor}18`, border: `1px solid ${meta.tagColor}40`,
                    color: meta.tagColor, letterSpacing: '0.02em',
                  }}>● {meta.tag}</span>
                </div>
              </div>
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
                padding: '6px 10px', borderRadius: 10,
                background: `${sc}15`, border: `1px solid ${sc}30`, flexShrink: 0,
              }}>
                <span style={{ fontSize: 18, fontWeight: 900, color: sc, lineHeight: 1 }}>
                  {scenario.severity}<span style={{ fontSize: 10, fontWeight: 600, opacity: 0.7 }}>/10</span>
                </span>
                <span style={{ fontSize: 9, color: sc, fontWeight: 700, marginTop: 1 }}>{sevLabel(scenario.severity)}</span>
              </div>
            </div>
          </div>
        </div>

        <p style={{
          fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: 1.65, margin: 0,
          padding: '10px 12px', borderRadius: 8,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
        }}>{scenario.description}</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[
            { label: 'Suppliers at risk', value: affected.length || (suppliers?.length ?? '—'), color: '#a78bfa', icon: '🏭' },
            { label: 'Est. demand impact', value: `${impact}%`, color: sc, icon: '📉' },
            { label: 'Duration', value: meta.durationDefault, color: '#60a5fa', icon: '⏱' },
          ].map(stat => (
            <div key={stat.label} style={{
              background: 'rgba(255,255,255,0.04)', padding: '10px 8px', borderRadius: 10,
              textAlign: 'center', border: '1px solid rgba(255,255,255,0.07)',
            }}>
              <div style={{ fontSize: 13, marginBottom: 4 }}>{stat.icon}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginBottom: 4, lineHeight: 1.3 }}>{stat.label}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: stat.color }}>{stat.value}</div>
            </div>
          ))}
        </div>

        {affected.length > 0 && (
          <div style={{ padding: '9px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Affected Suppliers</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {affected.slice(0, 5).map((sup, i) => (
                <span key={i} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, fontWeight: 600, background: `${sc}15`, border: `1px solid ${sc}30`, color: sc }}>{sup.name}</span>
              ))}
              {affected.length > 5 && (
                <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  +{affected.length - 5} more
                </span>
              )}
            </div>
          </div>
        )}

        {(scenario.tags || []).length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {scenario.tags.map(cat => (
              <span key={cat} style={{
                fontSize: 9, padding: '3px 9px', borderRadius: 20, fontWeight: 700,
                background: 'rgba(124,107,255,0.15)', border: '1px solid rgba(124,107,255,0.3)',
                color: '#a78bfa', letterSpacing: '0.02em',
              }}>{cat}</span>
            ))}
          </div>
        )}

        <button
          disabled={!!loading}
          onClick={() => onTrigger(scenario)}
          style={{
            width: '100%', padding: '12px 16px', borderRadius: 10, border: 'none',
            fontWeight: 800, fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            background: isLoading
              ? 'linear-gradient(135deg, rgba(124,107,255,0.5), rgba(96,165,250,0.5))'
              : 'linear-gradient(135deg, #7c6bff 0%, #6366f1 50%, #4f46e5 100%)',
            color: '#fff',
            boxShadow: isLoading ? 'none' : '0 4px 20px rgba(124,107,255,0.4)',
            transition: 'all 0.2s',
            opacity: loading && !isLoading ? 0.5 : 1,
          }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.boxShadow = '0 6px 28px rgba(124,107,255,0.6)' }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = isLoading ? 'none' : '0 4px 20px rgba(124,107,255,0.4)' }}
        >
          {isLoading ? (
            <>
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: 16 }}>🤖</span>
              <span>9 Agents Running</span>
              <span style={{ fontFamily: 'monospace', background: 'rgba(255,255,255,0.18)', padding: '2px 8px', borderRadius: 6, fontSize: 12 }}>{elapsed}s</span>
              <span style={{ fontSize: 11, opacity: 0.7 }}>/ ~90s</span>
            </>
          ) : (
            <>
              <span style={{ fontSize: 15 }}>▶</span>
              <span>Run Scenario {String(index + 1).padStart(2, '0')}</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Threat Intelligence card ──────────────────────────────────────────────────

function ConfidenceBar({ value }) {
  const pct = Math.round(value * 100)
  const col  = pct >= 80 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#94a3b8'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: col, borderRadius: 3, transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color: col, minWidth: 32 }}>{pct}%</span>
    </div>
  )
}

function PredictedCard({ prediction, loading, onTrigger, elapsed }) {
  const sc        = sevColor(prediction.severity)
  const sig       = SIGNAL_META[prediction.signal_type] || SIGNAL_META.live_news
  const isLoading = loading === prediction.id

  return (
    <div style={{
      borderRadius: 14, overflow: 'hidden',
      border: `1px solid ${sig.border}`,
      background: `linear-gradient(160deg, ${sig.bg} 0%, rgba(8,11,30,0.72) 55%)`,
      boxShadow: `0 4px 28px ${sig.color}10`,
      transition: 'box-shadow 0.2s, border-color 0.2s',
      position: 'relative',
    }}
    onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 8px 36px ${sig.color}26`; e.currentTarget.style.borderColor = sig.color + '55' }}
    onMouseLeave={e => { e.currentTarget.style.boxShadow = `0 4px 28px ${sig.color}10`; e.currentTarget.style.borderColor = sig.border }}
    >
      {/* Left accent stripe */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: sig.color, borderRadius: '14px 0 0 14px' }} />
      {/* Top severity bar */}
      <div style={{ height: 2, background: `linear-gradient(90deg, ${sc}, ${sc}44)`, width: `${prediction.severity * 10}%`, marginLeft: 3 }} />

      <div style={{ padding: '14px 16px 16px 18px', display: 'flex', flexDirection: 'column', gap: 11 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 11, flexShrink: 0,
            background: sig.bg, border: `1.5px solid ${sig.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19,
          }}>{sig.icon}</div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 5 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 4,
                    background: sig.bg, border: `1px solid ${sig.border}`,
                    color: sig.color, letterSpacing: '0.07em', textTransform: 'uppercase',
                  }}>{sig.label}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.3, marginBottom: 3 }}>{prediction.name}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)' }}>📍 {prediction.location}</div>
              </div>
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
                padding: '5px 9px', borderRadius: 9,
                background: `${sc}15`, border: `1px solid ${sc}30`, flexShrink: 0,
              }}>
                <span style={{ fontSize: 17, fontWeight: 900, color: sc, lineHeight: 1 }}>
                  {prediction.severity}<span style={{ fontSize: 9, fontWeight: 600, opacity: 0.7 }}>/10</span>
                </span>
                <span style={{ fontSize: 8, color: sc, fontWeight: 700, marginTop: 1 }}>{sevLabel(prediction.severity)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        <p style={{
          fontSize: 11, color: 'rgba(255,255,255,0.58)', lineHeight: 1.65, margin: 0,
          padding: '9px 12px', borderRadius: 8,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.055)',
        }}>{prediction.description}</p>

        {/* Confidence */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Prediction Confidence</span>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>Source: {prediction.signal_source}</span>
          </div>
          <ConfidenceBar value={prediction.confidence} />
        </div>

        {/* Risk drivers */}
        {(prediction.drivers || []).length > 0 && (
          <div style={{ padding: '9px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,0.28)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 7 }}>Risk Drivers</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {prediction.drivers.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                  <span style={{ color: sig.color, fontSize: 9, marginTop: 2, flexShrink: 0 }}>▸</span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>{d}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Affected suppliers */}
        {(prediction.affected_suppliers || []).length > 0 && (
          <div style={{ padding: '9px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,0.28)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Suppliers At Risk</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {prediction.affected_suppliers.slice(0, 5).map((name, i) => (
                <span key={i} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, fontWeight: 600, background: `${sc}14`, border: `1px solid ${sc}28`, color: sc }}>{name}</span>
              ))}
              {prediction.affected_suppliers.length > 5 && (
                <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  +{prediction.affected_suppliers.length - 5} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Run button */}
        <button
          disabled={!!loading}
          onClick={() => onTrigger(prediction)}
          style={{
            width: '100%', padding: '11px 16px', borderRadius: 10, border: 'none',
            fontWeight: 800, fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
            background: isLoading
              ? `linear-gradient(135deg, ${sig.color}55, ${sig.color}33)`
              : `linear-gradient(135deg, ${sig.color}cc, ${sig.color}99)`,
            color: '#fff',
            boxShadow: isLoading ? 'none' : `0 4px 18px ${sig.color}40`,
            transition: 'all 0.2s',
            opacity: loading && !isLoading ? 0.45 : 1,
          }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.boxShadow = `0 6px 24px ${sig.color}60` }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = isLoading ? 'none' : `0 4px 18px ${sig.color}40` }}
        >
          {isLoading ? (
            <>
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: 15 }}>🤖</span>
              <span>Analysing Impact</span>
              <span style={{ fontFamily: 'monospace', background: 'rgba(255,255,255,0.15)', padding: '2px 7px', borderRadius: 5, fontSize: 11 }}>{elapsed}s</span>
            </>
          ) : (
            <>
              <span style={{ fontSize: 14 }}>▶</span>
              <span>Run Risk Analysis</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Signal summary strip ──────────────────────────────────────────────────────

function SignalStrip({ signalSources, total }) {
  if (!signalSources || Object.keys(signalSources).length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
      {Object.entries(signalSources).map(([type, count]) => {
        const m = SIGNAL_META[type] || { label: type, color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.25)', icon: '⚡' }
        return (
          <div key={type} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '3px 10px', borderRadius: 20,
            background: m.bg, border: `1px solid ${m.border}`,
            fontSize: 10, fontWeight: 700, color: m.color,
          }}>
            <span>{m.icon}</span><span>{count} {m.label}</span>
          </div>
        )
      })}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '3px 10px', borderRadius: 20,
        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
        fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)',
        marginLeft: 'auto',
      }}>
        {total} threat{total !== 1 ? 's' : ''} detected
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ScenarioCreator({ onTrigger, suppliers = [] }) {
  const [tab, setTab]               = useState('my')
  const [myScenarios, setMyScenarios] = useState([])
  const [predictions, setPredictions] = useState([])
  const [predMeta, setPredMeta]     = useState({ count: 0, signal_sources: {}, last_updated_utc: null })
  const [predLoading, setPredLoading] = useState(false)
  const [predError, setPredError]   = useState(null)
  const [loading, setLoading]       = useState(null)
  const [elapsed, setElapsed]       = useState(0)
  const timerRef                    = useRef(null)
  const [formData, setFormData]     = useState({
    name: '', description: '', location: '', type: 'Cyclone', severity: 5, tags: [],
  })
  const [tagInput, setTagInput] = useState('')

  useEffect(() => {
    api.getScenarios().then(res => setMyScenarios(res.custom || [])).catch(() => {})
  }, [])

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const loadScenarios = () => {
    api.getScenarios().then(res => setMyScenarios(res.custom || [])).catch(() => {})
  }

  const loadPredictions = () => {
    setPredLoading(true)
    setPredError(null)
    api.predictedDisruptions()
      .then(res => {
        setPredictions(res.predictions || [])
        setPredMeta({ count: res.count || 0, signal_sources: res.signal_sources || {}, last_updated_utc: res.last_updated_utc })
      })
      .catch(err => setPredError(err?.message || 'Failed to load predictions'))
      .finally(() => setPredLoading(false))
  }

  const handleTabChange = id => {
    setTab(id)
    if (id === 'intel' && predictions.length === 0 && !predLoading) loadPredictions()
  }

  const handleTrigger = async scenario => {
    setLoading(scenario.id || 'new')
    setElapsed(0)
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    await onTrigger({
      description:    scenario.description,
      location:       scenario.location,
      source:         scenario.signal_type ? 'Threat Intelligence' : 'Custom Scenario',
      event_type:     scenario.type,
      severity_score: scenario.severity,
    })
    clearInterval(timerRef.current)
    timerRef.current = null
    setLoading(null)
    setElapsed(0)
  }

  const handleAddTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData({ ...formData, tags: [...formData.tags, tagInput.trim()] })
      setTagInput('')
    }
  }
  const handleRemoveTag = tag => setFormData({ ...formData, tags: formData.tags.filter(t => t !== tag) })

  const handleSaveScenario = () => {
    if (!formData.name.trim()) return
    api.createScenario(formData).then(() => {
      setFormData({ name: '', description: '', location: '', type: 'Cyclone', severity: 5, tags: [] })
      setTagInput('')
      loadScenarios()
      setTab('my')
    }).catch(() => {})
  }

  const supplierZones = [...new Set((suppliers || []).map(s => s.zone).filter(Boolean))]
  const sevC = sevColor(formData.severity)

  const TABS = [
    { id: 'my',     label: 'My Playbook' },
    { id: 'intel',  label: 'Live Threats' },
    { id: 'create', label: 'Simulate Event' },
  ]

  return (
    <div className="panel">
      <PanelHeader
        label="Scenarios"
        accent="var(--primary)"
        right={
          <InfoTooltip
            title="Disruption Scenarios"
            description="My Playbook: ready-made disruption tests you can run instantly. Live Threats: AI-detected risks from live news, weather, and geopolitical signals specific to your supplier network. Simulate Event: build and run your own custom disruption."
          />
        }
      />
      <div style={{ padding: '12px 14px 16px' }}>
        <style>{`
          @keyframes spin  { to { transform: rotate(360deg) } }
          @keyframes ping  { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.35)} }
          @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        `}</style>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
          {TABS.map(({ id, label }) => {
            const isActive = tab === id
            const isIntel  = id === 'intel'
            return (
              <button key={id} onClick={() => handleTabChange(id)} style={{
                flex: 1, padding: '6px 8px',
                background: isActive
                  ? isIntel
                    ? 'linear-gradient(135deg, #f43f5e, #a855f7)'
                    : 'linear-gradient(135deg, #7c6bff, #6366f1)'
                  : 'rgba(255,255,255,0.04)',
                border: isActive ? 'none' : '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                color: isActive ? '#fff' : 'rgba(255,255,255,0.45)',
                fontSize: 10, fontWeight: 700, cursor: 'pointer',
                boxShadow: isActive
                  ? isIntel ? '0 2px 12px rgba(244,63,94,0.35)' : '0 2px 12px rgba(124,107,255,0.35)'
                  : 'none',
                transition: 'all 0.15s', whiteSpace: 'nowrap',
                position: 'relative',
              }}>
                {isIntel && !isActive && (
                  <span style={{
                    position: 'absolute', top: -4, right: -4,
                    width: 8, height: 8, borderRadius: '50%',
                    background: '#f43f5e', boxShadow: '0 0 6px #f43f5e',
                    animation: 'ping 1.5s ease-in-out infinite',
                  }} />
                )}
                {label}
              </button>
            )
          })}
        </div>

        {/* ── My Scenarios ─────────────────────────────────────────────────── */}
        {tab === 'my' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
              padding: '10px 14px', borderRadius: 10,
              background: 'rgba(124,107,255,0.08)',
              border: '1px solid rgba(124,107,255,0.18)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#a78bfa', letterSpacing: '0.08em', marginBottom: 7 }}>
                YOUR SUPPLY NETWORK — {suppliers.length} SUPPLIER{suppliers.length !== 1 ? 'S' : ''}
              </div>
              {supplierZones.length > 0 && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
                  {supplierZones.map(z => (
                    <span key={z} style={{
                      fontSize: 9, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                      background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.55)',
                    }}>{z}</span>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', lineHeight: 1.5 }}>
                Each scenario below affects specific suppliers in this network. Pick one to run the AI analysis.
              </div>
            </div>

            {myScenarios.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '28px 16px',
                border: '1px dashed rgba(124,107,255,0.25)', borderRadius: 12,
                color: 'rgba(255,255,255,0.25)', fontSize: 12,
              }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>No scenarios yet</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.18)' }}>
                  Add an event to your playbook or check Live Threats for AI-generated risk predictions
                </div>
              </div>
            ) : (
              myScenarios.map((scen, idx) => (
                <ScenarioCard
                  key={scen.id}
                  scenario={scen}
                  index={idx}
                  suppliers={suppliers}
                  loading={loading}
                  elapsed={elapsed}
                  onTrigger={handleTrigger}
                />
              ))
            )}
          </div>
        )}

        {/* ── Threat Intelligence ───────────────────────────────────────────── */}
        {tab === 'intel' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Panel header */}
            <div style={{
              padding: '12px 14px', borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(244,63,94,0.08), rgba(168,85,247,0.08))',
              border: '1px solid rgba(244,63,94,0.22)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#f43f5e', letterSpacing: '0.08em', marginBottom: 4 }}>
                    THREAT INTELLIGENCE
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.55 }}>
                    AI-synthesised risk signals from live weather, breaking news, geopolitical stability indices, Tier-2 structural SPOFs, and your portfolio's supply pressure — specific to your supplier network.
                  </div>
                </div>
                <button
                  onClick={loadPredictions}
                  disabled={predLoading}
                  style={{
                    flexShrink: 0, padding: '6px 12px', borderRadius: 7,
                    background: predLoading ? 'rgba(244,63,94,0.06)' : 'rgba(244,63,94,0.14)',
                    border: '1px solid rgba(244,63,94,0.3)',
                    color: '#f43f5e', fontSize: 10, fontWeight: 700,
                    cursor: predLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {predLoading ? '⟳ Scanning…' : '↻ Refresh'}
                </button>
              </div>
              {predMeta.last_updated_utc && (
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 6 }}>
                  Last scan: {new Date(predMeta.last_updated_utc).toLocaleTimeString()}
                </div>
              )}
            </div>

            {/* Loading skeleton */}
            {predLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[1, 2, 3].map(i => (
                  <div key={i} style={{
                    height: 165, borderRadius: 14,
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                    animation: 'pulse 1.8s ease-in-out infinite',
                  }} />
                ))}
              </div>
            )}

            {/* Error state */}
            {!predLoading && predError && (
              <div style={{
                padding: '14px 16px', borderRadius: 10,
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                color: '#ef4444', fontSize: 12,
              }}>
                ⚠ {predError}
              </div>
            )}

            {/* Empty state — no suppliers */}
            {!predLoading && !predError && predictions.length === 0 && (
              <div style={{
                textAlign: 'center', padding: '32px 16px',
                border: '1px dashed rgba(244,63,94,0.2)', borderRadius: 12,
              }}>
                <div style={{ fontSize: 30, marginBottom: 10 }}>🛰️</div>
                <div style={{ fontWeight: 700, fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>No signals detected</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', lineHeight: 1.6 }}>
                  Upload your suppliers to activate live threat synthesis. Once your network is loaded,
                  this panel surfaces real-time geopolitical, weather, Tier-2, and supply-pressure risk signals
                  specific to your portfolio.
                </div>
              </div>
            )}

            {/* Predictions */}
            {!predLoading && !predError && predictions.length > 0 && (
              <>
                <SignalStrip signalSources={predMeta.signal_sources} total={predMeta.count} />
                {predictions.map(pred => (
                  <PredictedCard
                    key={pred.id}
                    prediction={pred}
                    loading={loading}
                    elapsed={elapsed}
                    onTrigger={handleTrigger}
                  />
                ))}
              </>
            )}
          </div>
        )}

        {/* ── New Scenario ──────────────────────────────────────────────────── */}
        {tab === 'create' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Scenario Name</label>
              <input type="text" value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Q3 Monsoon Preparedness"
                style={{
                  width: '100%', marginTop: 6, padding: '10px 12px',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
                  background: 'rgba(255,255,255,0.04)', color: '#f1f5f9', fontSize: 12,
                  boxSizing: 'border-box', outline: 'none',
                }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Description</label>
              <textarea value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe the disruption scenario…"
                style={{
                  width: '100%', marginTop: 6, padding: '10px 12px',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
                  background: 'rgba(255,255,255,0.04)', color: '#f1f5f9', fontSize: 12,
                  minHeight: 72, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', outline: 'none',
                }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Location</label>
                <input type="text" value={formData.location}
                  onChange={e => setFormData({ ...formData, location: e.target.value })}
                  placeholder="e.g., Chennai"
                  style={{
                    width: '100%', marginTop: 6, padding: '10px 12px',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
                    background: 'rgba(255,255,255,0.04)', color: '#f1f5f9', fontSize: 12,
                    boxSizing: 'border-box', outline: 'none',
                  }} />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Type</label>
                <select value={formData.type}
                  onChange={e => setFormData({ ...formData, type: e.target.value })}
                  style={{
                    width: '100%', marginTop: 6, padding: '10px 12px',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
                    background: 'rgba(30,33,60,0.9)', color: '#f1f5f9', fontSize: 12,
                    boxSizing: 'border-box',
                  }}>
                  {Object.keys(TYPE_META).map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Severity</label>
                <div style={{ padding: '3px 10px', borderRadius: 20, background: `${sevC}18`, border: `1px solid ${sevC}40` }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: sevC }}>{formData.severity}</span>
                  <span style={{ fontSize: 9, color: sevC, opacity: 0.7 }}>/10 · {sevLabel(formData.severity)}</span>
                </div>
              </div>
              <input type="range" min="1" max="10" value={formData.severity}
                onChange={e => setFormData({ ...formData, severity: parseInt(e.target.value) })}
                style={{ width: '100%', accentColor: sevC }} />
            </div>

            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Tags / Categories</label>
              <div style={{ display: 'flex', gap: 6, marginTop: 6, marginBottom: 8 }}>
                <input type="text" value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                  placeholder="Type and press Enter…"
                  style={{
                    flex: 1, padding: '8px 10px',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
                    background: 'rgba(255,255,255,0.04)', color: '#f1f5f9', fontSize: 11, outline: 'none',
                  }} />
                <button onClick={handleAddTag}
                  style={{
                    padding: '8px 14px', background: 'rgba(124,107,255,0.2)',
                    border: '1px solid rgba(124,107,255,0.35)', borderRadius: 8,
                    color: '#a78bfa', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  }}>Add</button>
              </div>
              {formData.tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {formData.tags.map(tag => (
                    <div key={tag} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '3px 10px', borderRadius: 20,
                      background: 'rgba(124,107,255,0.15)', border: '1px solid rgba(124,107,255,0.3)',
                      fontSize: 10, color: '#a78bfa', fontWeight: 600,
                    }}>
                      {tag}
                      <button onClick={() => handleRemoveTag(tag)}
                        style={{ background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1, opacity: 0.7 }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
              <button onClick={handleSaveScenario} disabled={!formData.name.trim()}
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 8, border: 'none',
                  background: formData.name.trim() ? 'linear-gradient(135deg, #7c6bff, #4f46e5)' : 'rgba(124,107,255,0.2)',
                  color: 'white', fontSize: 12, fontWeight: 700,
                  cursor: formData.name.trim() ? 'pointer' : 'not-allowed',
                  boxShadow: formData.name.trim() ? '0 3px 14px rgba(124,107,255,0.4)' : 'none',
                }}>Save Scenario</button>
              <button onClick={() => handleTrigger(formData)} disabled={!formData.name.trim() || !!loading}
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 8,
                  background: formData.name.trim() ? 'rgba(45,212,191,0.1)' : 'transparent',
                  border: formData.name.trim() ? '1px solid rgba(45,212,191,0.3)' : '1px solid rgba(255,255,255,0.06)',
                  color: formData.name.trim() ? '#2dd4bf' : 'rgba(255,255,255,0.2)',
                  fontSize: 12, fontWeight: 700,
                  cursor: formData.name.trim() ? 'pointer' : 'not-allowed',
                }}>Trigger Now</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
