import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../services/api.js'
import { Tag, severityColor, InfoTooltip } from '../components/ui.jsx'

const STATUS_LABEL = {
  awaiting_hil: { text: 'Awaiting Review', color: 'var(--warning)' },
  confirmed: { text: 'Action Confirmed', color: 'var(--info)' },
  resolved: { text: 'Resolved', color: 'var(--success)' },
  below_threshold: { text: 'No Action Needed', color: 'var(--text-dim)' },
  escalated_to_human: { text: 'Escalated', color: 'var(--danger)' },
  processing: { text: 'Processing', color: 'var(--primary)' },
}

function statusInfo(status) {
  return STATUS_LABEL[status] || { text: status, color: 'var(--text-dim)' }
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
      {children}
    </div>
  )
}

function InfoRow({ label, value, valueColor }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ fontSize: 12, color: valueColor || 'var(--text-pri)', fontWeight: 500, textAlign: 'right', maxWidth: '55%' }}>{value}</span>
    </div>
  )
}

function EventCard({ event, isSelected, onClick }) {
  const monitor = event.monitor || {}
  const sevColor = severityColor(monitor.severity_score || 0)
  const st = statusInfo(event.status)
  const title = monitor.event_type
    ? `${monitor.event_type}${monitor.geography ? ` — ${monitor.geography}` : ''}`
    : (monitor.description || 'Disruption Event').slice(0, 60)
  const time = (event.last_updated_utc || monitor.timestamp_utc || '').replace('T', ' ').slice(0, 16)

  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '14px 16px',
        borderRadius: 10,
        width: '100%',
        border: isSelected
          ? `1px solid ${sevColor}`
          : '1px solid rgba(255,255,255,0.1)',
        background: isSelected
          ? `${sevColor}12`
          : 'rgba(255,255,255,0.04)',
        transition: 'all 0.3s ease',
        cursor: 'pointer',
      }}
      onMouseOver={(e) => {
        if (!isSelected) {
          e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'
        }
      }}
      onMouseOut={(e) => {
        if (!isSelected) {
          e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
        }
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40,
          height: 40,
          borderRadius: 999,
          flexShrink: 0,
          background: `${sevColor}20`,
          color: sevColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          fontWeight: 800,
          border: `1px solid ${sevColor}40`,
        }}>
          {monitor.severity_score || 0}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--text-pri)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>🕐 {time}</span>
            {monitor.source && <span>· {monitor.source}</span>}
          </div>
        </div>
        {event.cascade_alert && <span title="Cascade event" style={{ color: 'var(--pink)', fontSize: 16, flexShrink: 0 }}>🔗</span>}
      </div>
      <div style={{ marginTop: 10 }}>
        <span style={{
          padding: '4px 10px',
          borderRadius: 12,
          fontSize: 11,
          fontWeight: 700,
          background: `${st.color}20`,
          color: st.color,
          display: 'inline-block',
        }}>
          {st.text}
        </span>
      </div>
    </button>
  )
}

export default function EventHistory() {
  const [events, setEvents] = useState([])
  const [selected, setSelected] = useState(null)
  const [nlQueries, setNlQueries] = useState([])
  const [audit, setAudit] = useState([])
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSeverity, setFilterSeverity] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const [page, setPage] = useState(1)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const loadEvents = async () => {
    try {
      setIsRefreshing(true)
      const eventsData = await api.listEvents()
      setEvents(eventsData || [])
    } catch (err) {
      console.error('Events load error:', err)
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    let alive = true
    loadEvents()
    const t = setInterval(() => { if (alive) loadEvents() }, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  useEffect(() => {
    if (!selected?.event_id) return
    api.nlQueries(selected.event_id).then(setNlQueries).catch(() => {})
    api.auditLog(selected.event_id).then(setAudit).catch(() => {})
  }, [selected])

  const filtered = useMemo(() => {
    const rows = [...events].filter(event => {
      const monitor = event.monitor || {}
      if (searchQ) {
        const text = `${monitor.geography || ''} ${monitor.event_type || ''} ${monitor.description || ''}`.toLowerCase()
        if (!text.includes(searchQ.toLowerCase())) return false
      }
      if (filterStatus && event.status !== filterStatus) return false
      if (filterSeverity) {
        const sev = monitor.severity_score || 0
        if (filterSeverity === 'critical' && sev < 8) return false
        if (filterSeverity === 'high' && (sev < 5 || sev >= 8)) return false
        if (filterSeverity === 'low' && sev >= 5) return false
      }
      return true
    })
    rows.sort((a, b) => {
      const at = a.last_updated_utc || a.monitor?.timestamp_utc || ''
      const bt = b.last_updated_utc || b.monitor?.timestamp_utc || ''
      return bt.localeCompare(at)
    })
    return rows
  }, [events, filterStatus, filterSeverity, searchQ])

  const pageRows = filtered.slice((page - 1) * 10, page * 10)
  const totalPages = Math.max(1, Math.ceil(filtered.length / 10))

  const stats = useMemo(() => {
    const sevs = events.map(e => e.monitor?.severity_score || 0)
    return {
      total: events.length,
      resolved: events.filter(e => e.status === 'resolved').length,
      awaiting: events.filter(e => e.status === 'awaiting_hil').length,
      cascades: events.filter(e => e.cascade_alert).length,
      avgSev: sevs.length ? (sevs.reduce((a, b) => a + b, 0) / sevs.length).toFixed(1) : '0.0',
    }
  }, [events])

  const monitor = selected?.monitor || {}
  const sevColor = severityColor(monitor.severity_score || 0)
  const st = statusInfo(selected?.status)

  return (
    <div style={{ maxWidth: 1700, margin: '0 auto', width: '100%', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Page header */}
      <div className="panel" style={{
        background: 'linear-gradient(135deg, rgba(124,107,255,0.1) 0%, rgba(45,212,191,0.05) 100%)',
        border: '1px solid rgba(124,107,255,0.2)',
        borderRadius: 16,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '32px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-pri)', marginBottom: 4 }}>Event History</div>
            <div style={{ color: 'var(--text-sec)', lineHeight: 1.6, maxWidth: 560, fontSize: 14 }}>
              Complete log of every disruption event your supply chain has experienced. Click any event to review the AI analysis, actions taken, and actual outcomes recorded by your team.
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={loadEvents} disabled={isRefreshing} style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            whiteSpace: 'nowrap',
          }}>
            {isRefreshing ? '↻' : '↻'} {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div style={{ padding: '0 28px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          {[
            { label: 'Total Events', value: stats.total, color: 'var(--primary)', icon: '⚡' },
            { label: 'Resolved', value: stats.resolved, color: 'var(--success)', icon: '✓' },
            { label: 'Awaiting Review', value: stats.awaiting, color: 'var(--warning)', icon: '⏳' },
            { label: 'Chain Reactions', value: stats.cascades, color: 'var(--pink)', icon: '🔗' },
            { label: 'Avg Severity', value: `${stats.avgSev}/10`, color: 'var(--info)', icon: '📊' },
          ].map(s => (
            <div key={s.label} style={{
              padding: '16px 14px',
              borderRadius: 12,
              position: 'relative',
              overflow: 'hidden',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              transition: 'all 0.3s ease',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = `${s.color}15`
              e.currentTarget.style.borderColor = `${s.color}40`
              e.currentTarget.style.transform = 'translateY(-2px)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>{s.icon}</span>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '400px minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>

        {/* Left column: filters + list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          <div className="panel" style={{
            padding: '16px',
            background: 'linear-gradient(135deg, rgba(124,107,255,0.08), rgba(96,165,250,0.04))',
            borderBottom: '1px solid rgba(124,107,255,0.2)',
            borderRadius: '12px 12px 0 0',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                placeholder="🔍 Search by event, location, or description"
                value={searchQ}
                onChange={e => { setSearchQ(e.target.value); setPage(1) }}
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(124,107,255,0.3)',
                  color: 'var(--text-pri)',
                  fontSize: 13,
                }}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }} style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(124,107,255,0.3)',
                  color: 'var(--text-pri)',
                  fontSize: 13,
                }}>
                  <option value="">All Statuses</option>
                  <option value="awaiting_hil">Awaiting Review</option>
                  <option value="confirmed">Action Confirmed</option>
                  <option value="resolved">Resolved</option>
                  <option value="below_threshold">No Action Needed</option>
                  <option value="escalated_to_human">Escalated</option>
                </select>
                <select value={filterSeverity} onChange={e => { setFilterSeverity(e.target.value); setPage(1) }} style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(124,107,255,0.3)',
                  color: 'var(--text-pri)',
                  fontSize: 13,
                }}>
                  <option value="">All Severity Levels</option>
                  <option value="critical">Critical (8–10)</option>
                  <option value="high">High (5–7)</option>
                  <option value="low">Low (1–4)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="panel" style={{
            overflow: 'hidden',
            background: 'linear-gradient(135deg, rgba(124,107,255,0.06), rgba(96,165,250,0.03))',
            borderRadius: '12px',
          }}>
            <div style={{
              padding: '16px',
              background: 'linear-gradient(135deg, rgba(124,107,255,0.1), rgba(96,165,250,0.05))',
              borderBottom: '1px solid rgba(124,107,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-pri)' }}>⚡ Events</span>
                <Tag color="var(--primary)" style={{ fontSize: 12, fontWeight: 700 }}>{filtered.length}</Tag>
              </div>
              <InfoTooltip title="Event History" description="A full log of every disruption event your supply chain has experienced. Click any event to review the complete AI analysis — risk scores, demand forecast, recovery actions taken, and the actual outcome recorded by your team." />
            </div>
            <div style={{ maxHeight: 'calc(100vh - 420px)', overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pageRows.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: 28, textAlign: 'center' }}>
                  📭 No events match your filters.
                </div>
              ) : pageRows.map(event => (
                <EventCard
                  key={event.event_id}
                  event={event}
                  isSelected={selected?.event_id === event.event_id}
                  onClick={() => setSelected(event)}
                />
              ))}
            </div>
            {totalPages > 1 && (
              <div style={{
                padding: '12px 16px',
                background: 'rgba(255,255,255,0.02)',
                borderTop: '1px solid rgba(124,107,255,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}>
                <button className="btn btn-sm btn-ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
                <span style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600, minWidth: 40, textAlign: 'center' }}>{page} / {totalPages}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next →</button>
              </div>
            )}
          </div>
        </div>

        {/* Right column: event detail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!selected ? (
            <div className="panel" style={{
              padding: '32px 24px',
              background: 'linear-gradient(135deg, rgba(124,107,255,0.08), rgba(96,165,250,0.04))',
              border: '1px solid rgba(124,107,255,0.2)',
              borderRadius: 12,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>👈</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-pri)', marginBottom: 6 }}>Select an event to inspect</div>
              <div style={{ fontSize: 13, color: 'var(--text-sec)', lineHeight: 1.65, maxWidth: 380, margin: '0 auto' }}>
                Click any event on the left to see the full breakdown — what the AI detected, how it assessed risk, what action was recommended, and what actually happened.
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="panel" style={{
                background: `linear-gradient(135deg, ${sevColor}12 0%, rgba(255,255,255,0.02) 100%)`,
                border: `1px solid ${sevColor}30`,
                borderRadius: 12,
              }}>
                <div style={{ padding: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                    <div style={{
                      width: 50,
                      height: 50,
                      borderRadius: 999,
                      background: `${sevColor}25`,
                      color: sevColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
                      fontWeight: 800,
                      flexShrink: 0,
                      border: `1px solid ${sevColor}50`,
                    }}>
                      {monitor.severity_score || 0}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-pri)' }}>
                        {monitor.event_type || 'Disruption Event'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-sec)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>📍 {monitor.geography || '—'}</span>
                        <span>·</span>
                        <span>Severity {monitor.severity_score || 0}/10</span>
                      </div>
                    </div>
                    <span style={{
                      padding: '6px 14px',
                      borderRadius: 12,
                      fontSize: 12,
                      fontWeight: 700,
                      background: `${st.color}25`,
                      color: st.color,
                      flexShrink: 0,
                    }}>
                      {st.text}
                    </span>
                  </div>
                  {monitor.description && (
                    <div style={{ fontSize: 13, color: 'var(--text-sec)', lineHeight: 1.65, padding: '12px 0', borderTop: `1px solid ${sevColor}20` }}>
                      {monitor.description}
                    </div>
                  )}
                  {(monitor.source || selected.cascade_alert) && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      {monitor.source && <Tag color="var(--info)" style={{ fontSize: 11 }}>{monitor.source}</Tag>}
                      {selected.cascade_alert && <Tag color="var(--pink)" style={{ fontSize: 11 }}>🔗 Cascade Event</Tag>}
                    </div>
                  )}
                </div>
              </div>

              {/* Cascade */}
              {selected.cascade_alert && (
                <div className="panel" style={{
                  background: 'linear-gradient(135deg, rgba(236,72,153,0.1), rgba(244,114,182,0.05))',
                  border: '1px solid rgba(236,72,153,0.3)',
                  borderRadius: 12,
                }}>
                  <div style={{
                    padding: '14px 18px',
                    background: 'rgba(236,72,153,0.12)',
                    borderBottom: '1px solid rgba(236,72,153,0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    <span style={{ fontSize: 14 }}>🔗</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--pink)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Cascade Alert — Linked Disruption</span>
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                  <SectionLabel style={{ display: 'none' }}>⚠ Cascade Alert — Linked Disruption</SectionLabel>
                  <div style={{ fontSize: 13, color: 'var(--text-sec)', lineHeight: 1.65, marginBottom: 10 }}>
                    This event is happening at the same time as another disruption that shares some of your suppliers.
                    Combined, they create a bigger risk than either event alone.
                  </div>
                  <InfoRow label="Summary" value={selected.cascade_alert.summary} />
                  <InfoRow label="Combined Severity" value={`${selected.cascade_alert.combined_severity_score}/10`} />
                  <InfoRow label="Shared Zone" value={selected.cascade_alert.overlap_zone} />
                  </div>
                </div>
              )}

              {/* AI forecast */}
              {selected.forecast && (
                <div className="panel" style={{
                  background: 'linear-gradient(135deg, rgba(96,165,250,0.08), rgba(124,107,255,0.04))',
                  border: '1px solid rgba(96,165,250,0.25)',
                  borderRadius: 12,
                }}>
                  <div style={{
                    padding: '14px 18px',
                    background: 'rgba(96,165,250,0.12)',
                    borderBottom: '1px solid rgba(96,165,250,0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    <span style={{ fontSize: 14 }}>🧠</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--info)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>AI Forecast</span>
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                  <SectionLabel style={{ display: 'none' }}>AI Forecast</SectionLabel>
                  <div style={{ fontSize: 13, color: 'var(--text-sec)', marginBottom: 10, lineHeight: 1.65 }}>
                    Based on historical patterns and your current supplier network, the AI predicted the following impact.
                  </div>
                  <InfoRow
                    label="Predicted demand shift"
                    value={`${(selected.forecast.demand_shift_percentage || 0) > 0 ? '+' : ''}${selected.forecast.demand_shift_percentage || 0}%`}
                    valueColor={(selected.forecast.demand_shift_percentage || 0) < 0 ? 'var(--danger)' : 'var(--success)'}
                  />
                  {selected.forecast.narrative && (
                    <div style={{ fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.65, marginTop: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(96,165,250,0.08)' }}>
                      {selected.forecast.narrative}
                    </div>
                  )}
                  </div>
                </div>
              )}

              {/* Human decision */}
              {selected.hil_decision && (
                <div className="panel" style={{
                  background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(251,146,60,0.04))',
                  border: '1px solid rgba(245,158,11,0.25)',
                  borderRadius: 12,
                }}>
                  <div style={{
                    padding: '14px 18px',
                    background: 'rgba(245,158,11,0.12)',
                    borderBottom: '1px solid rgba(245,158,11,0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    <span style={{ fontSize: 14 }}>👤</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--warning)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Review Decision</span>
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                  <SectionLabel style={{ display: 'none' }}>Review Decision</SectionLabel>
                  <div style={{ fontSize: 13, color: 'var(--text-sec)', lineHeight: 1.65, marginBottom: 10 }}>
                    A team member reviewed the AI-recommended options and approved an action.
                  </div>
                  <InfoRow label="Reviewed by" value={selected.hil_decision.reviewer_id} />
                  <InfoRow label="Action chosen" value={`Option ${selected.hil_decision.selected_option_rank}`} />
                  <InfoRow label="Reviewed at" value={(selected.hil_decision.timestamp_utc || '').replace('T', ' ').slice(0, 16)} />
                  </div>
                </div>
              )}

              {/* Outcome */}
              {selected.counterfactual && (
                <div className="panel" style={{
                  background: 'linear-gradient(135deg, rgba(45,212,191,0.1), rgba(16,185,129,0.04))',
                  border: '1px solid rgba(45,212,191,0.3)',
                  borderRadius: 12,
                }}>
                  <div style={{
                    padding: '14px 18px',
                    background: 'rgba(45,212,191,0.15)',
                    borderBottom: '1px solid rgba(45,212,191,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    <span style={{ fontSize: 14 }}>✓</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Resolved — What Actually Happened</span>
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                  <SectionLabel style={{ display: 'none' }}>✓ Resolved — What Actually Happened</SectionLabel>
                  <div style={{ fontSize: 13, color: 'var(--text-sec)', lineHeight: 1.65, marginBottom: 10 }}>
                    This event has been resolved. The AI has compared its prediction against the actual outcome
                    and will use this to improve future estimates.
                  </div>
                  <InfoRow label="What happened" value={selected.counterfactual.actual_outcome} />
                  <InfoRow label="Prediction accuracy" value={selected.counterfactual.prediction_variance} />
                  {selected.counterfactual.recalibration_recommended && (
                    <div style={{ marginTop: 10, fontSize: 12, color: 'var(--warning)', lineHeight: 1.5, padding: '10px 12px', background: 'rgba(245,158,11,0.1)', borderRadius: 8 }}>
                      ⚠️ The AI's prediction was further from the actual outcome than expected. Future estimates for similar events have been adjusted.
                    </div>
                  )}
                  </div>
                </div>
              )}

              {/* NL queries */}
              {nlQueries.length > 0 && (
                <div className="panel" style={{
                  background: 'linear-gradient(135deg, rgba(192,132,252,0.08), rgba(168,85,247,0.04))',
                  border: '1px solid rgba(192,132,252,0.25)',
                  borderRadius: 12,
                }}>
                  <div style={{
                    padding: '14px 18px',
                    background: 'rgba(192,132,252,0.12)',
                    borderBottom: '1px solid rgba(192,132,252,0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    <span style={{ fontSize: 14 }}>💬</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Questions Asked About This Event</span>
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                  <SectionLabel style={{ display: 'none' }}>Questions Asked About This Event</SectionLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {nlQueries.map(q => (
                      <div key={q.id} style={{ padding: '12px 14px', background: 'rgba(192,132,252,0.08)', border: '1px solid rgba(192,132,252,0.2)', borderRadius: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)', marginBottom: 6 }}>❓ {q.question}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.6 }}>{q.response}</div>
                      </div>
                    ))}
                  </div>
                  </div>
                </div>
              )}

              {/* Audit timeline */}
              {audit.length > 0 && (
                <div className="panel" style={{
                  background: 'linear-gradient(135deg, rgba(124,107,255,0.08), rgba(96,165,250,0.04))',
                  border: '1px solid rgba(124,107,255,0.25)',
                  borderRadius: 12,
                }}>
                  <div style={{
                    padding: '14px 18px',
                    background: 'rgba(124,107,255,0.12)',
                    borderBottom: '1px solid rgba(124,107,255,0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    <span style={{ fontSize: 14 }}>⏱️</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Timeline — What the AI Did</span>
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                  <SectionLabel style={{ display: 'none' }}>Timeline — What the AI Did</SectionLabel>
                  <div style={{ fontSize: 12, color: 'var(--text-sec)', marginBottom: 14, lineHeight: 1.5 }}>
                    A step-by-step log of every action taken when processing this event.
                  </div>
                  <div style={{ position: 'relative', paddingLeft: 24 }}>
                    <div style={{ position: 'absolute', left: 8, top: 8, bottom: 6, width: 2, background: 'linear-gradient(180deg, var(--primary), rgba(124,107,255,0.1))' }} />
                    {audit.map((entry, i) => (
                      <div key={entry.id || i} style={{ position: 'relative', paddingBottom: 16, animation: 'slideUp 0.3s ease-out' }}>
                        <div style={{ position: 'absolute', left: -18, top: 2, width: 12, height: 12, borderRadius: 999, background: 'var(--primary)', border: '2px solid var(--bg-base)', boxShadow: '0 0 0 3px rgba(124,107,255,0.2)' }} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--info)', background: 'rgba(96,165,250,0.15)', padding: '2px 8px', borderRadius: 6 }}>{entry.agent}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>{(entry.timestamp_utc || '').slice(11, 19)}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-sec)', marginTop: 4, lineHeight: 1.5 }}>
                          {entry.action}{entry.output_summary ? ` — ${entry.output_summary}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
