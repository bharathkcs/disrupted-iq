import React, { useEffect, useState, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import { api } from '../services/api.js'
import { InfoTooltip } from '../components/ui.jsx'

const LINE_COLORS = [
  '#7c6bff', '#60a5fa', '#2dd4bf', '#f59e0b', '#c084fc',
  '#ec4899', '#34d399', '#fb923c', '#a3e635', '#f472b6',
]

function avg(arr) {
  if (!arr.length) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function trend7(trendData) {
  if (trendData.length < 7) return 0
  const recent = avg(trendData.slice(-7).map(d => d.health_score))
  const older  = avg(trendData.slice(0, 7).map(d => d.health_score))
  return recent - older
}

function generateAnalysis(selectedSuppliers) {
  if (!selectedSuppliers.length) return null

  const stats = selectedSuppliers.map(s => {
    const scores    = s.trend_data.map(d => d.health_score)
    const current   = s.current_health_score
    const delta7    = trend7(s.trend_data)
    const minScore  = Math.min(...scores)
    const maxScore  = Math.max(...scores)
    const volatility = maxScore - minScore
    const direction = delta7 > 2 ? 'improving' : delta7 < -2 ? 'declining' : 'stable'
    return { ...s, current, delta7, minScore, maxScore, volatility, direction }
  })

  const declining     = stats.filter(s => s.direction === 'declining')
  const improving     = stats.filter(s => s.direction === 'improving')
  const stable        = stats.filter(s => s.direction === 'stable')
  const highRisk      = stats.filter(s => s.current < 70)
  const excellent     = stats.filter(s => s.current >= 90)
  const volatile      = [...stats].sort((a, b) => b.volatility - a.volatility).filter(s => s.volatility > 15)
  const portfolioAvg  = Math.round(avg(stats.map(s => s.current)))

  const insights = []

  if (declining.length) {
    const worst = [...declining].sort((a, b) => a.delta7 - b.delta7)[0]
    const names = declining.map(s => s.name).join(', ')
    insights.push({
      type: 'warning',
      icon: '📉',
      headline: `${declining.length} supplier${declining.length > 1 ? 's' : ''} trending downward over the last 7 days`,
      detail: `${names} ${declining.length > 1 ? 'have' : 'has'} declined over the past week. `
        + `${worst.name} shows the steepest drop (${worst.delta7.toFixed(1)} pts), currently scoring ${worst.current}/100. `
        + `A falling health score signals worsening reliability, thinner buffer stock, or increased disruption activity in that zone. `
        + `Consider pre-qualifying a backup supplier for ${worst.name}'s categories before this deteriorates further.`,
    })
  }

  if (improving.length) {
    const best = [...improving].sort((a, b) => b.delta7 - a.delta7)[0]
    const names = improving.map(s => s.name).join(', ')
    insights.push({
      type: 'good',
      icon: '📈',
      headline: `${improving.length} supplier${improving.length > 1 ? 's' : ''} on an upward trend`,
      detail: `${names} ${improving.length > 1 ? 'have' : 'has'} improved meaningfully over the last 7 days. `
        + `${best.name} leads with a +${best.delta7.toFixed(1)}-point gain, now at ${best.current}/100. `
        + `Improving scores typically reflect better buffer replenishment, higher reliability, or recovery from a past disruption. `
        + `These suppliers are actively strengthening your supply chain resilience.`,
    })
  }

  if (highRisk.length) {
    const names = highRisk.map(s => `${s.name} (${s.current})`).join(', ')
    insights.push({
      type: 'danger',
      icon: '⚠️',
      headline: `${highRisk.length} supplier${highRisk.length > 1 ? 's' : ''} below the 70/100 risk threshold`,
      detail: `${names} ${highRisk.length > 1 ? 'are' : 'is'} in the high-risk zone. `
        + `Scores below 70 indicate a combination of low reliability, thin buffer stock, or limited site redundancy. `
        + `Review these suppliers in the Risk Analysis panel and consider running a disruption simulation for their geographic zones.`,
    })
  }

  if (volatile.length) {
    const s = volatile[0]
    insights.push({
      type: 'info',
      icon: '〰️',
      headline: `${s.name} shows high score volatility — ${s.volatility.toFixed(0)}-point swing over 30 days`,
      detail: `${s.name}'s health score ranged from ${s.minScore} to ${s.maxScore} over the 30-day window. `
        + `High volatility often indicates an operationally unstable supplier: intermittent stock-outs, inconsistent reliability reporting, or repeated small disruptions. `
        + `Even if the current score looks acceptable, this pattern warrants closer monitoring and a contingency plan.`,
    })
  }

  if (excellent.length && !declining.length && !highRisk.length) {
    const names = excellent.map(s => s.name).join(', ')
    insights.push({
      type: 'good',
      icon: '✅',
      headline: `${excellent.length} supplier${excellent.length > 1 ? 's' : ''} in the excellent bracket (90+)`,
      detail: `${names} ${excellent.length > 1 ? 'are' : 'is'} scoring 90 or above — the top performance tier. `
        + `These suppliers demonstrate strong reliability, healthy buffer stock, and multiple production sites. `
        + `They should be prioritised in any disruption recovery plan as your most resilient sourcing options.`,
    })
  }

  if (stable.length === stats.length && !highRisk.length) {
    insights.push({
      type: 'info',
      icon: '📊',
      headline: 'All selected suppliers are holding steady',
      detail: `No significant trend movement detected across the 30-day window. `
        + `Portfolio average for this selection is ${portfolioAvg}/100. `
        + `Stable scores are a positive signal — revisit after any regional disruption event that could affect these supplier zones.`,
    })
  }

  return { insights, stats, portfolioAvg }
}

const TYPE_STYLE = {
  danger:  { border: 'rgba(239,68,68,0.3)',   bg: 'rgba(239,68,68,0.06)',   color: '#ef4444' },
  warning: { border: 'rgba(249,115,22,0.3)',  bg: 'rgba(249,115,22,0.06)',  color: '#f97316' },
  good:    { border: 'rgba(34,197,94,0.3)',   bg: 'rgba(34,197,94,0.06)',   color: '#22c55e' },
  info:    { border: 'rgba(96,165,250,0.25)', bg: 'rgba(96,165,250,0.05)',  color: '#60a5fa' },
}

export default function SupplierTrends() {
  const [data, setData]         = useState(null)
  const [selected, setSelected] = useState([])
  const [error, setError]       = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = async () => {
    try {
      setRefreshing(true)
      const res = await api.supplierTrends()
      setData(res)
      setSelected(prev => {
        if (prev.length) return prev
        const sorted = (res.suppliers || []).sort((a, b) => b.current_health_score - a.current_health_score)
        return sorted.slice(0, Math.min(5, sorted.length)).map(s => s.id)
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    let alive = true
    load()
    const t = setInterval(() => { if (alive) load() }, 30000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const selectedSuppliers = useMemo(
    () => (data?.suppliers || []).filter(s => selected.includes(s.id)),
    [data, selected]
  )

  const analysis = useMemo(() => generateAnalysis(selectedSuppliers), [selectedSuppliers])

  const chartData = useMemo(() => {
    if (!selectedSuppliers.length) return []
    const allDates = new Set()
    selectedSuppliers.forEach(s => s.trend_data.forEach(t => allDates.add(t.date)))
    return Array.from(allDates).sort().map(date => {
      const row = { date }
      selectedSuppliers.forEach(sup => {
        const trend = sup.trend_data.find(t => t.date === date)
        row[sup.id] = trend?.health_score ?? null
      })
      return row
    })
  }, [selectedSuppliers])

  if (error) return <div style={{ padding: 24, color: 'var(--danger)' }}>Error: {error}</div>

  if (!data || !data.suppliers || data.suppliers.length === 0) {
    return (
      <div style={{ maxWidth: 1700, margin: '0 auto', width: '100%', padding: 16 }}>
        <div className="panel" style={{
          padding: '60px 20px',
          textAlign: 'center',
          background: 'linear-gradient(135deg, rgba(124,107,255,0.08), rgba(96,165,250,0.03))',
          border: '1px solid rgba(124,107,255,0.2)',
          borderRadius: 14,
        }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>📈</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-pri)', marginBottom: 8 }}>No supplier data yet</div>
          <div style={{ fontSize: 14, color: 'var(--text-sec)', maxWidth: 480, margin: '0 auto' }}>
            Upload suppliers on the <strong>Config</strong> page to see 30-day health trends and track supplier performance changes.
          </div>
        </div>
      </div>
    )
  }

  const toggleSupplier = (id) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 10 ? [...prev, id] : prev
    )
  }

  return (
    <div style={{ maxWidth: 1700, margin: '0 auto', width: '100%', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div className="panel" style={{
        background: 'linear-gradient(135deg, rgba(124,107,255,0.1) 0%, rgba(45,212,191,0.05) 100%)',
        border: '1px solid rgba(124,107,255,0.2)',
        borderRadius: 16,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '32px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-pri)' }}>📈 Supplier Health Trends</span>
              <InfoTooltip title="Supplier Health Trends" description="30-day health score trends for every supplier — combining reliability, buffer stock, site count, and proximity. A falling line means a supplier is getting riskier. Select up to 10 suppliers to compare side-by-side and act before a problem becomes critical." />
            </div>
            <div style={{ color: 'var(--text-sec)', lineHeight: 1.6, maxWidth: 680, fontSize: 14 }}>
              Compare 30-day health trends across your supply base. A falling line signals deteriorating reliability, thin buffers, or increased disruption risk — ideal for early intervention planning.
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={load} disabled={refreshing} style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            whiteSpace: 'nowrap',
          }}>
            {refreshing ? '↻' : '↻'} {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Supplier selector */}
      <div className="panel" style={{
        background: 'linear-gradient(135deg, rgba(124,107,255,0.08), rgba(96,165,250,0.03))',
        border: '1px solid rgba(124,107,255,0.25)',
        borderRadius: 14,
      }}>
        <div style={{
          padding: '18px 24px',
          background: 'rgba(124,107,255,0.12)',
          borderBottom: '1px solid rgba(124,107,255,0.25)',
        }}>
          <div style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--text-dim)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span>🔍 Select suppliers to compare</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, background: 'rgba(124,107,255,0.3)', padding: '2px 8px', borderRadius: 6 }}>
              max 10 · {selected.length} selected
            </span>
          </div>
        </div>
        <div style={{ padding: '18px 24px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {data.suppliers.map(sup => {
              const isSelected = selected.includes(sup.id)
              const globalIdx  = data.suppliers.findIndex(s => s.id === sup.id)
              const color = LINE_COLORS[globalIdx % LINE_COLORS.length]
              return (
                <button
                  key={sup.id}
                  onClick={() => toggleSupplier(sup.id)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: isSelected ? 700 : 600,
                    cursor: 'pointer',
                    background: isSelected
                      ? `linear-gradient(135deg, ${color}20, ${color}10)`
                      : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${isSelected ? color + '60' : 'rgba(255,255,255,0.1)'}`,
                    color: isSelected ? color : 'var(--text-sec)',
                    transition: 'all 0.35s cubic-bezier(0.23, 1, 0.320, 1)',
                    boxShadow: isSelected
                      ? `inset 0 0 12px ${color}20, 0 0 16px ${color}40`
                      : `inset 0 0 8px rgba(255,255,255,0.02)`,
                  }}
                  onMouseOver={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'
                      e.currentTarget.style.boxShadow = 'inset 0 0 12px rgba(255,255,255,0.04), 0 0 12px rgba(255,255,255,0.15)'
                    }
                  }}
                  onMouseOut={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
                      e.currentTarget.style.boxShadow = 'inset 0 0 8px rgba(255,255,255,0.02)'
                    }
                  }}
                >
                  {sup.name.length > 18 ? sup.name.substring(0, 18) + '…' : sup.name}
                  <span style={{ marginLeft: 6, opacity: 0.8, fontWeight: 700, color }}>({sup.current_health_score})</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Chart */}
      {selected.length > 0 && (
        <div className="panel" style={{
          background: 'linear-gradient(135deg, rgba(124,107,255,0.08), rgba(96,165,250,0.03))',
          border: '1px solid rgba(124,107,255,0.25)',
          borderRadius: 14,
        }}>
          <div style={{
            padding: '18px 24px',
            background: 'rgba(124,107,255,0.12)',
            borderBottom: '1px solid rgba(124,107,255,0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span style={{ fontSize: 16 }}>📊</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-pri)' }}>30-Day Health Score Comparison</span>
          </div>
          <div style={{ padding: '18px 24px' }}>
            <ResponsiveContainer width="100%" height={380}>
            <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: '#64748b' }}
                interval={Math.floor(chartData.length / 6)}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: '#64748b' }}
                label={{ value: 'Health Score (0–100)', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <ReferenceLine
                y={70}
                stroke="rgba(249,115,22,0.4)"
                strokeDasharray="4 4"
                label={{ value: 'Risk threshold (70)', fill: '#f97316', fontSize: 10, position: 'insideTopRight' }}
              />
              <Tooltip
                contentStyle={{ background: 'rgba(6,9,24,0.97)', border: '1px solid rgba(124,107,255,0.4)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#a78bfa', fontWeight: 700, marginBottom: 6 }}
                itemStyle={{ color: '#e2e8f0' }}
                cursor={{ stroke: 'rgba(124,107,255,0.3)', strokeDasharray: '5 5' }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8', paddingTop: 8 }} />
              {selectedSuppliers.map(sup => {
                const globalIdx = data.suppliers.findIndex(s => s.id === sup.id)
                const color = LINE_COLORS[globalIdx % LINE_COLORS.length]
                return (
                  <Line
                    key={sup.id}
                    type="monotone"
                    dataKey={sup.id}
                    stroke={color}
                    name={sup.name}
                    dot={false}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                )
              })}
            </LineChart>
            </ResponsiveContainer>
            <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
              📊 Orange dashed line = risk threshold (70/100). Scores below this need attention.
            </div>
          </div>
        </div>
      )}

      {/* Dynamic analysis — updates when selection changes */}
      {analysis && (
        <div className="panel" style={{
          background: 'linear-gradient(135deg, rgba(124,107,255,0.08), rgba(96,165,250,0.03))',
          border: '1px solid rgba(124,107,255,0.25)',
          borderRadius: 14,
        }}>
          <div style={{
            padding: '18px 24px',
            background: 'rgba(124,107,255,0.12)',
            borderBottom: '1px solid rgba(124,107,255,0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span style={{ fontSize: 16 }}>💡</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-pri)' }}>Chart Analysis</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-dim)', fontWeight: 600 }}>
              Portfolio avg: <span style={{ color: 'var(--primary)', fontWeight: 800 }}>{analysis.portfolioAvg}/100</span>
            </span>
          </div>
          <div style={{ padding: '18px 24px' }}>
            {analysis.insights.length === 0 ? (
              <div style={{ color: 'var(--text-sec)', fontSize: 13, padding: '20px', textAlign: 'center' }}>
                Select suppliers above to see analysis.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {analysis.insights.map((ins, i) => {
                  const ts = TYPE_STYLE[ins.type] || TYPE_STYLE.info
                  return (
                    <div key={i} style={{
                      padding: '16px 16px',
                      borderRadius: 12,
                      background: ts.bg,
                      border: `1px solid ${ts.border}`,
                      animation: `slideUp ${0.4 + i * 0.08}s ease-out`,
                      transition: 'all 0.3s ease',
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.borderColor = ts.color + '80'
                      e.currentTarget.style.transform = 'translateY(-2px)'
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.borderColor = ts.border
                      e.currentTarget.style.transform = 'translateY(0)'
                    }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 18 }}>{ins.icon}</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: ts.color }}>{ins.headline}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.7, marginLeft: 28 }}>{ins.detail}</div>
                    </div>
                  )
                })}
              </div>
            )}

            {analysis.stats.length > 1 && (
              <div style={{
                marginTop: 20,
                paddingTop: 18,
                borderTop: '1px solid rgba(255,255,255,0.08)',
              }}>
                <div style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: 'var(--text-dim)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  <span>📋</span> Supplier breakdown
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{
                        color: 'var(--text-dim)',
                        fontSize: 10,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        borderBottom: '1px solid rgba(255,255,255,0.1)',
                        fontWeight: 700,
                      }}>
                        <th style={{ textAlign: 'left', padding: '10px 8px' }}>Supplier</th>
                        <th style={{ textAlign: 'right', padding: '10px 8px' }}>Current</th>
                        <th style={{ textAlign: 'right', padding: '10px 8px' }}>7-day Δ</th>
                        <th style={{ textAlign: 'right', padding: '10px 8px' }}>30-day range</th>
                        <th style={{ textAlign: 'left', padding: '10px 8px' }}>Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.stats.map((s, idx) => {
                        const globalIdx  = data.suppliers.findIndex(d => d.id === s.id)
                        const lineColor  = LINE_COLORS[globalIdx % LINE_COLORS.length]
                        const changeColor = s.delta7 > 2 ? '#22c55e' : s.delta7 < -2 ? '#ef4444' : '#94a3b8'
                        const trendLabel = s.direction === 'improving' ? '📈 Improving' : s.direction === 'declining' ? '📉 Declining' : '→ Stable'
                        return (
                          <tr key={s.id} style={{
                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                            animation: `slideUp ${0.3 + idx * 0.05}s ease-out`,
                            transition: 'all 0.2s ease',
                          }}
                          onMouseOver={(e) => {
                            e.currentTarget.style.background = 'rgba(124,107,255,0.08)'
                          }}
                          onMouseOut={(e) => {
                            e.currentTarget.style.background = 'transparent'
                          }}
                          >
                            <td style={{ padding: '10px 8px', color: lineColor, fontWeight: 700 }}>{s.name}</td>
                            <td style={{
                              padding: '10px 8px',
                              textAlign: 'right',
                              color: s.current < 70 ? '#ef4444' : s.current >= 90 ? '#22c55e' : '#e2e8f0',
                              fontWeight: 800,
                            }}>{s.current}</td>
                            <td style={{
                              padding: '10px 8px',
                              textAlign: 'right',
                              color: changeColor,
                              fontWeight: 700,
                            }}>
                              {s.delta7 > 0 ? '+' : ''}{s.delta7.toFixed(1)}
                            </td>
                            <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--text-dim)', fontWeight: 600 }}>{s.minScore}–{s.maxScore}</td>
                            <td style={{ padding: '10px 8px', color: changeColor, fontWeight: 700 }}>{trendLabel}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
