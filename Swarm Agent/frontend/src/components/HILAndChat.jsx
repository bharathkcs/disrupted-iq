import React, { useState, useEffect, useRef } from 'react'
import { PanelHeader, Tag, InfoTooltip } from './ui.jsx'
import { api } from '../services/api.js'

function newsIcon(n) {
  const txt = ((n.title || '') + ' ' + (n.description || '')).toLowerCase()
  if (txt.includes('cyclone') || txt.includes('hurricane') || txt.includes('typhoon'))
    return { icon: '🌀', anim: 'spin 4s linear infinite' }
  if (txt.includes('flood') || txt.includes('rain') || txt.includes('monsoon') || txt.includes('storm'))
    return { icon: '🌧️', anim: 'float-soft 2s ease-in-out infinite' }
  if (txt.includes('earthquake') || txt.includes('seismic') || txt.includes('tremor'))
    return { icon: '⚠️', anim: 'pulse-ring 1.8s ease-out infinite' }
  if (txt.includes('fire') || txt.includes('blaze') || txt.includes('wildfire'))
    return { icon: '🔥', anim: 'float-soft 1.2s ease-in-out infinite' }
  if (txt.includes('port') || txt.includes('ship') || txt.includes('vessel') || txt.includes('dock'))
    return { icon: '⚓', anim: 'float-soft 3s ease-in-out infinite' }
  if (txt.includes('strike') || txt.includes('labour') || txt.includes('labor') || txt.includes('worker') || txt.includes('union'))
    return { icon: '✊', anim: 'float-soft 2.5s ease-in-out infinite' }
  if (txt.includes('power') || txt.includes('blackout') || txt.includes('grid') || txt.includes('outage'))
    return { icon: '⚡', anim: 'pulse-ring 1.5s ease-out infinite' }
  if (txt.includes('road') || txt.includes('traffic') || txt.includes('highway'))
    return { icon: '🚦', anim: 'none' }
  if (n.source === 'Open-Meteo' || txt.includes('weather') || txt.includes('temperature'))
    return { icon: '🌤️', anim: 'float-soft 3s ease-in-out infinite' }
  return { icon: '📰', anim: 'none' }
}

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Math.floor((Date.now() - new Date(ts)) / 60000)
  if (diff < 1) return 'just now'
  if (diff < 60) return `${diff}m ago`
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`
  return `${Math.floor(diff / 1440)}d ago`
}

export function NewsFeed() {
  const [news, setNews] = useState([])
  const [liveDot, setLiveDot] = useState(true)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const load = () => api.newsLatest()
      .then(data => setNews((data?.alerts || data) || []))
      .catch(() => {})
    load()
    const t = setInterval(load, 60000)
    const d = setInterval(() => setLiveDot(v => !v), 900)
    return () => { clearInterval(t); clearInterval(d) }
  }, [])

  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.10)',
      borderRadius: 16,
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    }}>
      {/* Header — clickable to collapse */}
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          padding: '12px 16px', cursor: 'pointer', userSelect: 'none',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: collapsed ? 'none' : '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: liveDot ? '#10b981' : 'transparent',
            border: '1.5px solid #10b981',
            display: 'inline-block',
            transition: 'background 0.4s',
            boxShadow: liveDot ? '0 0 6px #10b981' : 'none',
          }} />
          <span style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>Live News Alerts</span>
          {news.length > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px',
              background: 'rgba(96,165,250,0.2)', color: '#60a5fa',
              borderRadius: 10, border: '1px solid rgba(96,165,250,0.3)',
            }}>{news.length}</span>
          )}
        </div>
        <span style={{
          fontSize: 14, color: 'rgba(255,255,255,0.45)',
          display: 'inline-block',
          transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s ease',
          lineHeight: 1,
        }}>▾</span>
      </div>

      {/* Scroll area + Footer — only shown when expanded */}
      {!collapsed && (
        <>
          <div className="news-feed-scroll" style={{
            height: 500,
            overflowY: 'scroll',
            overflowX: 'hidden',
            padding: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            boxSizing: 'border-box',
          }}>
            {news.length === 0 ? (
              <div style={{ textAlign: 'center', paddingTop: 80 }}>
                <div style={{ fontSize: 30, marginBottom: 12, display: 'inline-block', animation: 'spin 3s linear infinite' }}>🛰️</div>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: 0 }}>Scanning live feeds…</p>
              </div>
            ) : news.map((n, i) => {
              const sc = n.severity >= 8 ? '#ef4444' : n.severity >= 6 ? '#f59e0b' : '#10b981'
              const isWeather = n.source === 'Open-Meteo'
              const { icon, anim } = newsIcon(n)
              const hasUrl = !!n.url
              const accentColor = isWeather ? '#2dd4bf' : '#7c6bff'

              return (
                <div key={i} style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: `1px solid ${accentColor}30`,
                  borderLeft: `3px solid ${sc}`,
                  borderRadius: 10,
                  padding: '12px',
                  flexShrink: 0,
                }}>
                  {/* Top row: icon + title */}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 8, flexShrink: 0,
                      background: `${sc}20`,
                      border: `1px solid ${sc}40`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 20,
                    }}>
                      <span style={{ animation: anim, display: 'inline-block' }}>{icon}</span>
                    </div>
                    <p style={{
                      margin: 0, fontSize: 12.5, fontWeight: 700, color: '#fff',
                      lineHeight: 1.5, flex: 1,
                    }}>{n.title}</p>
                  </div>

                  {/* Description */}
                  {n.description && (
                    <p style={{
                      margin: '0 0 10px', fontSize: 11, color: 'rgba(255,255,255,0.6)',
                      lineHeight: 1.55, paddingLeft: 48,
                    }}>{n.description}</p>
                  )}

                  {/* Badges row 1: severity + location */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                    {typeof n.severity === 'number' && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: sc,
                        background: `${sc}20`, border: `1px solid ${sc}40`,
                        padding: '2px 7px', borderRadius: 5,
                      }}>{n.severity}/10</span>
                    )}
                    {n.location && (
                      <span style={{
                        fontSize: 10, color: 'rgba(255,255,255,0.55)',
                        background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
                        padding: '2px 7px', borderRadius: 5,
                      }}>📍 {n.location}</span>
                    )}
                  </div>

                  {/* Source + time row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {hasUrl ? (
                      <a href={n.url} target="_blank" rel="noopener noreferrer" style={{
                        fontSize: 10, fontWeight: 700, color: accentColor,
                        background: `${accentColor}20`, border: `1px solid ${accentColor}40`,
                        padding: '3px 8px', borderRadius: 5,
                        textDecoration: 'none', cursor: 'pointer',
                      }}>🔗 {n.source} ↗</a>
                    ) : (
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: accentColor,
                        background: `${accentColor}20`, border: `1px solid ${accentColor}40`,
                        padding: '3px 8px', borderRadius: 5,
                      }}>{n.source}</span>
                    )}
                    <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>
                      {timeAgo(n.published_at || n.timestamp_utc)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <div style={{
            padding: '7px 14px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            fontSize: 10, color: 'rgba(255,255,255,0.3)',
            textAlign: 'center',
          }}>
            {news.length} live alerts · drag the scrollbar to browse all
          </div>
        </>
      )}
    </div>
  )
}

const CHAT_INTRO = "👋 Hi! I'm your AI supply-chain analyst. Ask me anything — which suppliers are at risk and why, what to do in the next 24 hours, the demand impact, recovery options, or how to use any part of the platform. I'll explain it clearly and connect the dots."

const CHAT_INTRO_GENERAL = "👋 Hi! I'm your AI supply-chain analyst, always here to help. Ask me about platform features, supply-chain best practices, how to set up your suppliers, or anything else. Trigger a disruption analysis to unlock event-specific insights."

const DEMO_ACCOUNT_REPLY = "This is a demo environment — account-specific information isn't available here. To access your own account details, billing, and settings, please create a free account. It only takes a minute and gives you your own secure workspace with full supplier management and real-time disruption analysis."

const ACCOUNT_KEYWORDS = [
  'my account', 'account info', 'account detail', 'my profile', 'my email',
  'my password', 'billing', 'subscription', 'invoice', 'payment', 'plan',
  'my data', 'my settings', 'change password', 'delete account', 'cancel',
  'sign up', 'register', 'create account', 'onboard',
]

function isAccountQuestion(text) {
  const lower = text.toLowerCase()
  return ACCOUNT_KEYWORDS.some(kw => lower.includes(kw))
}

const GENERAL_SUGGESTIONS = [
  'How do I add suppliers?',
  'What does the Resilience Score mean?',
  'How do I trigger a disruption analysis?',
  'What is a cascade event?',
  'Where can I find past events?',
]

// Builds 5 situation-specific starter questions from the current analysis
function buildSuggestions(state) {
  const generic = [
    'What should I do first?',
    'How serious is this disruption?',
    'Which suppliers are most affected?',
    'What are my recovery options?',
    'How long until things recover?',
  ]
  if (!state) return generic

  const q = []
  const suppliers = state.risk?.suppliers || []
  const topSupplier = [...suppliers].sort(
    (a, b) => (b.composite_score || 0) - (a.composite_score || 0),
  )[0]
  const evtType = state.monitor?.event_type || 'disruption'

  if (topSupplier?.supplier_name) q.push(`Why is ${topSupplier.supplier_name} high risk?`)
  if (state.action?.options?.length) q.push('Which recovery option is best?')
  if (state.forecast?.affected_categories?.length) q.push('How much will demand change?')
  if (state.cascade_alert) q.push('Why is this a chain reaction?')
  if (state.divergence?.dissent_detected) q.push('Why do the experts disagree?')
  if (state.simulation) q.push('What are the possible outcomes?')
  q.push(`How serious is this ${evtType}?`)
  q.push('What should I do first?')
  q.push('Which suppliers are most affected?')

  return [...new Set([...q, ...generic])].slice(0, 5)
}

export function NLChat({ eventId, state, demoMode = false }) {
  const getIntro = (eid) => eid ? CHAT_INTRO : (demoMode ? CHAT_INTRO : CHAT_INTRO_GENERAL)
  const [msgs, setMsgs] = useState([{ from: 'system', text: getIntro(eventId) }])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const ref = useRef(null)

  // Refresh conversation each time the active event changes
  useEffect(() => {
    setMsgs([{ from: 'system', text: getIntro(eventId) }])
    setInput('')
    setBusy(false)
  }, [eventId, demoMode])

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [msgs, busy])

  const suggestions = eventId ? buildSuggestions(state) : (demoMode ? [] : GENERAL_SUGGESTIONS)

  const send = async (q = input) => {
    const txt = (q || '').trim()
    if (!txt || busy) return
    setInput('')
    setMsgs(m => [...m, { from: 'user', text: txt }])

    // Demo mode: block account-related questions with signup guidance
    if (demoMode && isAccountQuestion(txt)) {
      setMsgs(m => [...m, { from: 'agent', text: DEMO_ACCOUNT_REPLY }])
      return
    }

    setBusy(true)
    try {
      const body = eventId ? { event_id: eventId, question: txt } : { question: txt }
      const r = await api.nlQuery(body)
      setMsgs(m => [...m, { from: 'agent', text: r.response, agent: r.answered_by || r.agent_context_used }])
    } catch (e) {
      setMsgs(m => [...m, { from: 'agent', text: "Sorry, I couldn't get an answer right now. Please try again in a moment." }])
    }
    setBusy(false)
  }

  // Show starter chips until the user has asked their first question.
  const showSuggestions = msgs.filter(m => m.from === 'user').length === 0 && suggestions.length > 0

  return (
    <div className="panel nlchat-panel" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: collapsed ? 'auto' : 620, overflow: 'hidden' }}>
      <div className="nlchat-header">
        <div className="nlchat-header-left">
          <div className="nlchat-orb">
            <span className="nlchat-orb-core">✦</span>
          </div>
          <div>
            <div className="nlchat-title">Ask the Assistant</div>
            <div className="nlchat-subtitle">{eventId ? 'Analyzing your active disruption' : 'Your AI supply-chain analyst'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="nlchat-status">
            <span className="live-dot" />
            <span>{eventId ? 'event mode' : 'general mode'}</span>
          </span>
          <button className="nlchat-collapse-btn" onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? '▸' : '▾'}
          </button>
        </div>
      </div>

      {!collapsed && <div ref={ref} className="chat-scroll nlchat-scroll" style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 8px', minHeight: 0, overflow: 'hidden auto' }}>
        {msgs.map((m, i) => {
          if (m.from === 'system') {
            return (
              <div key={i} className="chat-bubble system" style={{ alignSelf: 'stretch', maxWidth: '100%', textAlign: 'center' }}>
                {m.text}
              </div>
            )
          }
          const isUser = m.from === 'user'
          return (
            <div key={i} className={`chat-row ${isUser ? 'user' : 'ai'}`}>
              <div className={`chat-avatar ${isUser ? 'user' : 'ai'}`}>
                {isUser ? '🧑' : '✦'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', minWidth: 0 }}>
                {m.agent && <span className="chat-attrib">✦ {m.agent}</span>}
                <div className={`chat-bubble ${isUser ? 'user' : 'ai'}`}>{m.text}</div>
              </div>
            </div>
          )
        })}
        {busy && (
          <div className="chat-row ai">
            <div className="chat-avatar ai">✦</div>
            <div className="chat-bubble ai">
              <span className="typing-dots"><span /><span /><span /></span>
            </div>
          </div>
        )}
        {showSuggestions && (
          <div className="nlchat-suggestions">
            <p className="nlchat-suggestions-label">💡 Try asking</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {suggestions.map((s, i) => (
                <button key={i} className="chip" onClick={() => send(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>}

      {!collapsed && <div className="nlchat-inputbar" style={{ flexShrink: 0 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          disabled={busy}
          placeholder={eventId ? 'Ask anything about this disruption or the platform…' : 'Ask about the platform, supply chain, or any feature…'}
          className="nlchat-input"
        />
        <button
          className="nlchat-send"
          onClick={() => send()}
          disabled={busy || !input.trim()}
          style={{
            background: 'linear-gradient(135deg,#7c6bff,#6354e8)',
            color: '#fff',
            border: 'none',
            borderRadius: 24,
            padding: '10px 20px',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            minWidth: 76,
            height: 44,
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>}
    </div>
  )
}

export function HILConfirm({ state, onConfirmed, onAck }) {
  const [reviewer, setReviewer] = useState('SC-Lead-001')
  const [coReviewer, setCoReviewer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (!state) return null
  const eid = state.event_id

  const dissent = state.divergence?.dissent_detected
  const cascade = !!state.cascade_alert
  const acks = state.acknowledgements || {}
  const dissent_acked = !dissent || 'dissent' in acks
  const cascade_acked = !cascade || 'cascade' in acks
  const memory_acked = !state.memory_recalls?.length || 'memory' in acks
  const sla_breach = !!state.sla_breach_ack_required
  const sla_breach_acked = !sla_breach || 'sla_breach' in acks
  const sim_ready = !!state.simulation
  const option_selected = state.selected_option

  const severity = state.monitor?.severity_score || 0
  const critical = state.risk?.critical_count || 0
  const co_required = severity >= 9 || critical >= 2
  const co_ok = !co_required || coReviewer.trim().length > 0

  const all_clear = dissent_acked && cascade_acked && memory_acked && sla_breach_acked && sim_ready && option_selected && co_ok
  const confirmed = state.status === 'confirmed'

  const confirm = async () => {
    if (!all_clear) return
    setBusy(true)
    setError(null)
    try {
      await api.hilConfirm({
        event_id: eid,
        selected_option_rank: option_selected,
        reviewer_id: reviewer,
        co_reviewer_id: coReviewer || null,
        acknowledged_dissent: dissent_acked,
        acknowledged_cascade: cascade_acked,
        simulation_reviewed: true,
      })
      onConfirmed()
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  if (confirmed) {
    return (
      <div className="panel" style={{ borderColor: 'var(--success)', display: 'flex', flexDirection: 'column', height: '100%', width: '100%', minWidth: 0, minHeight: 0 }}>
        <PanelHeader label="Review & Confirm" accent="var(--success)" right={<InfoTooltip title="Human Approval Gate" description="The AI cannot proceed without your explicit sign-off here. Review the recommended action, check all acknowledgements, and confirm to execute the recovery plan. Severity 9+ events require a second approver." />} />
        <div style={{ padding: 18, textAlign: 'center', overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <span style={{ fontSize: 28, color: 'var(--success)' }}>✓</span>
          <p className="mono" style={{ color: 'var(--success)', marginTop: 6, fontSize: 12, fontWeight: 600 }}>
            Action signal generated
          </p>
          <p className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
            Option #{state.hil_decision?.selected_option_rank} · {state.hil_decision?.reviewer_id}
          </p>
        </div>
      </div>
    )
  }

  const rows = [
    { label: 'Scenario Analysis Complete', ok: sim_ready, ack: null },
    { label: 'Past Events Reviewed', ok: memory_acked, ack: state.memory_recalls?.length && !memory_acked ? () => onAck('memory') : null },
    { label: 'Expert Disagreement Acknowledged', ok: dissent_acked, ack: dissent && !dissent_acked ? () => onAck('dissent') : null },
    { label: 'Chain Reaction Risk Acknowledged', ok: cascade_acked, ack: cascade && !cascade_acked ? () => onAck('cascade') : null },
    { label: 'Response Time Review Acknowledged', ok: sla_breach_acked, ack: sla_breach && !sla_breach_acked ? () => onAck('sla_breach') : null },
    { label: 'Action Option Selected', ok: !!option_selected, ack: null },
    co_required && { label: 'Second Approver Assigned', ok: co_ok, ack: null },
  ].filter(Boolean)

  return (
    <div className="panel" style={{ borderColor: all_clear ? 'var(--primary)' : 'var(--glass-border)', display: 'flex', flexDirection: 'column', height: '100%', width: '100%', minWidth: 0, minHeight: 0 }}>
      <PanelHeader
        label="Review & Confirm"
        accent="var(--primary)"
        right={
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            {rows.filter(r => r.ok).length}/{rows.length} ready
          </span>
        }
      />
      <div style={{ padding: 14, overflowY: 'auto', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 14 }}>
          {rows.map((r, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 11px', borderRadius: 9,
              background: r.ok ? 'rgba(45,212,191,0.07)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${r.ok ? 'rgba(45,212,191,0.22)' : 'var(--glass-border)'}`,
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                background: r.ok ? 'var(--success)' : 'transparent',
                border: `1.5px solid ${r.ok ? 'var(--success)' : 'var(--glass-border-bright)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#06231f', fontSize: 11, fontWeight: 800,
              }}>
                {r.ok ? '✓' : ''}
              </span>
              <span style={{
                flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.35,
                color: r.ok ? 'var(--text-pri)' : 'var(--text-sec)',
                fontWeight: r.ok ? 500 : 400,
              }}>
                {r.label}
              </span>
              {r.ack && (
                <button
                  onClick={r.ack}
                  style={{
                    flexShrink: 0, whiteSpace: 'nowrap', alignSelf: 'center',
                    padding: '6px 13px', fontSize: 11, fontWeight: 600,
                    borderRadius: 7, cursor: 'pointer',
                    background: 'rgba(245,158,11,0.16)',
                    border: '1px solid var(--warning)',
                    color: 'var(--warning)',
                  }}
                >
                  Acknowledge
                </button>
              )}
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: 12, marginBottom: 12 }}>
          <span className="eyebrow">Reviewer</span>
          <input
            value={reviewer}
            onChange={e => setReviewer(e.target.value)}
            style={{ marginTop: 4, marginBottom: 8 }}
          />
          {co_required && (
            <>
              <span className="eyebrow" style={{ color: 'var(--danger)' }}>Second Approver (required for high-risk decisions)</span>
              <input
                value={coReviewer}
                onChange={e => setCoReviewer(e.target.value)}
                placeholder="Manager ID"
                style={{ marginTop: 4 }}
              />
            </>
          )}
        </div>

        {error && (
          <p className="mono" style={{ fontSize: 10, color: 'var(--danger)', marginBottom: 8 }}>
            {error}
          </p>
        )}

        <button className="btn btn-primary" onClick={confirm} disabled={!all_clear || busy} style={{ width: '100%' }}>
          {busy ? 'Confirming...' : all_clear ? 'Approve & Execute' : 'Complete steps above'}
        </button>
      </div>
    </div>
  )
}

export function ResolutionPanel({ eventId, onResolved }) {
  const [outcome, setOutcome] = useState('')
  const [shift, setShift] = useState('')
  const [busy, setBusy] = useState(false)
  const presets = [
    'Supplier delivered 3 days late despite low risk score',
    'Full disruption resolved on schedule - no delays',
    'Air-freight succeeded - premium cost absorbed',
    'Partial fulfillment - 60% week 1, remainder week 3',
  ]

  const submit = async () => {
    if (!outcome.trim()) return
    setBusy(true)
    try {
      await api.resolve({ event_id: eventId, actual_outcome: outcome, actual_demand_shift: shift ? parseFloat(shift) : null })
      onResolved()
    } catch (e) {}
    setBusy(false)
  }
  return (
    <div className="panel" style={{ borderColor: 'var(--success)44' }}>
      <PanelHeader label="Record the Outcome" accent="var(--success)" right={<InfoTooltip title="Record Actual Outcome" description="After resolving the event, enter what actually happened. The AI compares this against its predictions and writes the difference into memory — so future forecasts for similar events become progressively more accurate." />} />
      <div style={{ padding: 14 }}>
        <p className="mono" style={{ fontSize: 11, color: 'var(--text-sec)', marginBottom: 10 }}>
          Record what actually happened so we can learn for next time.
        </p>
        <textarea
          rows="2"
          value={outcome}
          onChange={e => setOutcome(e.target.value)}
          placeholder="actual outcome description..."
          style={{ marginBottom: 8 }}
        />
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {presets.map((p, i) => (
            <button key={i} className="btn btn-sm btn-ghost" onClick={() => setOutcome(p)}>
              {p.slice(0, 28)}...
            </button>
          ))}
        </div>
        <input
          value={shift}
          onChange={e => setShift(e.target.value)}
          placeholder="actual demand shift % (optional, e.g. 18.5)"
          style={{ marginBottom: 10 }}
        />
        <button className="btn" onClick={submit} disabled={busy || !outcome.trim()} style={{ width: '100%', borderColor: 'var(--success)', color: 'var(--success)' }}>
          {busy ? 'Recording...' : 'Record Outcome & Learn'}
        </button>
      </div>
    </div>
  )
}

export function CounterfactualPanel({ records }) {
  if (!records?.length) return null
  return (
    <div className="panel">
      <PanelHeader label="What We've Learned" accent="var(--info)" right={<div style={{display:'flex',alignItems:'center',gap:6}}><Tag color="var(--info)">{records.length}</Tag><InfoTooltip title="Memory Recall" description="The AI searched past disruptions similar to this one and surfaced relevant experiences here. These recalled memories directly calibrate the risk scores and demand forecasts shown above — the more events you resolve, the smarter future predictions become." /></div>} />
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {records.map((cf, i) => (
          <div key={i} style={{ background: 'var(--bg-deep)', border: '1px solid var(--glass-border)', padding: 10, borderRadius: 'var(--radius)' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
              <Tag color="var(--info)">{cf.counterfactual_id}</Tag>
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{cf.event_id}</span>
              {cf.recalibration_recommended && <Tag color="var(--warning)">recalibration suggested</Tag>}
            </div>
            <p className="mono" style={{ fontSize: 11, color: 'var(--text-pri)', marginBottom: 4 }}>
              <span className="label">actual:</span> {cf.actual_outcome}
            </p>
            <p className="mono" style={{ fontSize: 10, color: 'var(--text-sec)', marginBottom: 3 }}>
              <span className="label">variance:</span> {cf.prediction_variance}
            </p>
            <p className="mono" style={{ fontSize: 10, color: 'var(--text-sec)', marginBottom: 3 }}>
              <span className="label">alt-A:</span> {cf.alternate_option_a_estimate}
            </p>
            <p className="mono" style={{ fontSize: 10, color: 'var(--text-sec)', marginBottom: 3 }}>
              <span className="label">alt-B:</span> {cf.alternate_option_b_estimate}
            </p>
            <p className="mono" style={{ fontSize: 10, color: 'var(--warning)', marginTop: 4 }}>
              <span className="label">learning signal:</span> {cf.learning_signal}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

const DEMO_SCENARIOS = [
  {
    id: 'DS1', icon: '🌀', newsTag: '🔴 IMD Alert',
    name: 'Cyclone Alert — Bay of Bengal',
    type: 'natural_disaster', location: 'Chennai', geography: 'South India', severity: 8,
    description: 'Cyclone Michaung intensifying over the Bay of Bengal. Category 3 landfall expected near Chennai port within 24 hours. Storm surges of 2–3 m predicted. Port operations pre-emptively suspended.',
    suppliers: ['Chennai-zone suppliers'],
    categories: ['Refrigeration', 'HVAC', 'Cold-Chain'],
    impact: 32, duration: '48–72 h',
  },
  {
    id: 'DS2', icon: '⛔', newsTag: '🟡 Labour News',
    name: 'Chennai Port Strike — Dock Workers',
    type: 'port_closure', location: 'Chennai', geography: 'South India', severity: 6,
    description: 'CITU dock workers union declares indefinite strike at Chennai port. Container movement halted. 2,000+ containers pending clearance. Cold-chain shipments at risk of spoilage after 48 hours.',
    suppliers: ['Chennai port-dependent suppliers'],
    categories: ['Cold-Chain', 'Refrigeration'],
    impact: 18, duration: '24–48 h',
  },
  {
    id: 'DS3', icon: '🏭', newsTag: '🟡 Industrial Action',
    name: 'Pune Manufacturing Strike',
    type: 'supplier_insolvency', location: 'Pune', geography: 'Maharashtra', severity: 7,
    description: "Workers at Pune's industrial belt declare a 5-day strike over a wage dispute. Pune-based supplier production at 0%. Electronics and refrigeration component supply lines at immediate risk.",
    suppliers: ['Pune-zone suppliers'],
    categories: ['Electronics', 'Refrigeration'],
    impact: 22, duration: '5 days',
  },
  {
    id: 'DS4', icon: '⚡', newsTag: '🟠 TNEB Notice',
    name: 'Tamil Nadu Grid Failure',
    type: 'geopolitical', location: 'Tamil Nadu', geography: 'South India', severity: 6,
    description: 'Tamil Nadu Electricity Board announces 12-hour daily power cuts across industrial zones due to peak summer demand. Coimbatore and surrounding manufacturing clusters facing planned outages until monsoon.',
    suppliers: ['Tamil Nadu suppliers'],
    categories: ['Electronics', 'Appliances', 'HVAC'],
    impact: 14, duration: '7–10 days',
  },
  {
    id: 'DS5', icon: '🌧️', newsTag: '🔴 IMD Red Alert',
    name: 'Mumbai Monsoon Flooding',
    type: 'natural_disaster', location: 'Mumbai', geography: 'West India', severity: 7,
    description: 'IMD issues red alert for Mumbai. 400 mm rainfall in 48 hours. Andheri and Thane industrial areas waterlogged. Mumbai-zone warehouses partially flooded — inbound and outbound logistics at a standstill.',
    suppliers: ['Mumbai-zone suppliers'],
    categories: ['Appliances', 'HVAC'],
    impact: 12, duration: '2–3 days',
  },
]

export function DemoLauncher({ onTrigger }) {
  const [loading, setLoading] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const timerRef = useRef(null)
  const sevColor = sev => sev >= 8 ? 'var(--danger)' : sev >= 6 ? 'var(--warning)' : 'var(--info)'

  const handleTrigger = async s => {
    setLoading(s.id)
    setElapsed(0)
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    await onTrigger({
      source: 'Weather Monitor',
      geography: s.geography,
      location: s.location,
      event_type: s.type,
      severity_score: s.severity,
      description: s.description,
      demo_mode: true,
    })
    clearInterval(timerRef.current)
    timerRef.current = null
    setLoading(null)
    setElapsed(0)
  }

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  return (
    <div className="panel">
      <PanelHeader
        label="Live Demo Scenarios"
        accent="var(--primary)"
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
      />
      {!collapsed && <div style={{ padding: '12px 14px 14px' }}>

        {/* Supply network summary */}
        <div style={{
          marginBottom: 14, padding: '9px 12px',
          background: 'rgba(124,107,255,0.07)',
          border: '1px solid rgba(124,107,255,0.16)', borderRadius: 9,
        }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.07em', margin: '0 0 6px' }}>
            DEMO SUPPLY NETWORK — 9 SUPPLIERS
          </p>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {['Chennai ×3', 'Coimbatore', 'Tamil Nadu', 'Pune', 'Mumbai', 'Bengaluru', 'Delhi'].map(z => (
              <span key={z} style={{
                fontSize: 9, padding: '2px 7px',
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'var(--text-sec)', borderRadius: 4,
              }}>{z}</span>
            ))}
          </div>
          <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '6px 0 0', lineHeight: 1.4 }}>
            Each scenario below affects specific suppliers in this network. Pick one to run the AI analysis.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {DEMO_SCENARIOS.map((s, idx) => {
            const sc = sevColor(s.severity)
            const isLoading = loading === s.id
            return (
              <div key={s.id} style={{
                background: 'linear-gradient(135deg, rgba(124,107,255,0.07) 0%, rgba(96,165,250,0.03) 100%)',
                border: `1px solid ${sc}44`, borderRadius: 10, overflow: 'hidden',
              }}>
                <div style={{ height: 3, background: sc, width: `${s.severity * 10}%` }} />
                <div style={{ padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 9 }}>

                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 9,
                      background: `${sc}22`, border: `1px solid ${sc}44`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 18, flexShrink: 0,
                    }}>{s.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-pri)', margin: '0 0 3px' }}>{s.name}</p>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{s.location}</span>
                        <span style={{ fontSize: 9, padding: '1px 6px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)', borderRadius: 3 }}>{s.newsTag}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: sc }}>{s.severity}/10</div>
                      <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>{s.severity >= 8 ? '⚠️ High' : '⚡ Medium'}</div>
                    </div>
                  </div>

                  <p style={{ fontSize: 11, color: 'var(--text-sec)', lineHeight: 1.55, margin: 0 }}>{s.description}</p>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                    {[
                      { label: 'Suppliers at risk', value: s.suppliers.length, color: 'var(--primary)' },
                      { label: 'Est. demand impact', value: `${s.impact}%`, color: sc },
                      { label: 'Duration', value: s.duration, color: 'var(--info)' },
                    ].map(stat => (
                      <div key={stat.label} style={{ background: 'rgba(255,255,255,0.04)', padding: '7px 8px', borderRadius: 7, textAlign: 'center' }}>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 3 }}>{stat.label}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: stat.color }}>{stat.value}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.025)', padding: '7px 10px', borderRadius: 7 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.06em' }}>AFFECTED: </span>
                    {s.suppliers.map((sup, i) => (
                      <span key={i} style={{ fontSize: 9, marginLeft: 4, color: sc, fontWeight: 600 }}>
                        {sup}{i < s.suppliers.length - 1 ? ' ·' : ''}
                      </span>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {s.categories.map(cat => (
                      <span key={cat} style={{ fontSize: 9, padding: '2px 7px', background: 'rgba(124,107,255,0.15)', color: 'var(--primary)', borderRadius: 4, fontWeight: 600 }}>{cat}</span>
                    ))}
                  </div>

                  <button
                    className="btn btn-primary"
                    disabled={!!loading}
                    onClick={() => handleTrigger(s)}
                    style={{
                      width: '100%', justifyContent: 'center', fontWeight: 700, fontSize: 12,
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: isLoading
                        ? 'linear-gradient(135deg, rgba(124,107,255,0.6) 0%, rgba(96,165,250,0.6) 100%)'
                        : undefined,
                    }}
                  >
                    {isLoading ? (
                      <>
                        <span style={{
                          display: 'inline-block',
                          animation: 'spin 1s linear infinite',
                          fontSize: 14,
                        }}>🤖</span>
                        <span>9 agents running</span>
                        <span style={{
                          fontFamily: 'monospace',
                          background: 'rgba(255,255,255,0.15)',
                          padding: '1px 7px',
                          borderRadius: 4,
                          fontSize: 11,
                          letterSpacing: '0.04em',
                        }}>{elapsed}s</span>
                        <span style={{ fontSize: 10, opacity: 0.7 }}>/ ~90s</span>
                      </>
                    ) : (
                      `▶ Run Scenario ${String(idx + 1).padStart(2, '0')}`
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>}
    </div>
  )
}

export function ReportSummary() {
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    const load = () => api.reportsSummary().then(setSummary).catch(() => {})
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="panel">
      <PanelHeader label="Team Performance" accent="var(--success)" right={<InfoTooltip title="Response Performance" description="Tracks how quickly and effectively your team responds to disruptions — acknowledgement speed, approval time, and decision quality. Use these metrics to benchmark and continuously improve your incident response process." />} />
      <div style={{ padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[
          ['Disruptions', summary?.event_count],
          ['Resolved', summary?.resolved_count],
          ['Disagreements', summary?.dissent_count],
          ['Chain Reactions', summary?.cascade_count],
          ['Scenarios Tested', summary ? `${summary.simulation_coverage_pct}%` : '...'],
          ['Results Recorded', summary ? `${summary.counterfactual_completion_rate_pct}%` : '...'],
        ].map(([label, value]) => (
          <div key={label} style={{ padding: 10, borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="eyebrow">{label}</p>
            <p className="mono" style={{ marginTop: 4, fontSize: 14, color: 'var(--text-pri)' }}>{value ?? '...'}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function EventHistoryPanel() {
  const [events, setEvents] = useState([])
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    const load = () => api.listEvents().then(data => {
      const sorted = [...(data || [])].sort((a, b) => (b.monitor?.timestamp_unix || 0) - (a.monitor?.timestamp_unix || 0))
      setEvents(sorted)
    }).catch(() => {})
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="panel">
      <PanelHeader label="Event History" accent="var(--purple)" right={<div style={{display:'flex',alignItems:'center',gap:6}}><Tag color="var(--purple)">{events.length}</Tag><InfoTooltip title="Past Events Log" description="A full record of every disruption event your supply chain has experienced. Click any event to review the complete AI analysis, which action was taken, and the actual outcome recorded — your organisation's institutional memory." /></div>} />
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
        {events.map(evt => {
          const isOpen = openId === evt.event_id
          return (
            <div key={evt.event_id} style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,0.03)' }}>
              <button
                onClick={() => setOpenId(isOpen ? null : evt.event_id)}
                style={{ width: '100%', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}
              >
                <span className="mono" style={{ color: 'var(--primary)', fontSize: 11 }}>{evt.event_id}</span>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--text-pri)' }}>{evt.monitor?.geography || evt.monitor?.description || 'Event'}</span>
                <Tag color={evt.cascade_alert ? 'var(--pink)' : evt.status === 'resolved' ? 'var(--info)' : 'var(--text-dim)'}>
                  {evt.status || 'open'}
                </Tag>
              </button>
              {isOpen && (
                <div style={{ padding: '0 12px 12px' }}>
                  <p className="mono" style={{ fontSize: 10, color: 'var(--text-sec)', marginBottom: 6 }}>
                    Severity {evt.monitor?.severity_score}/10 · {evt.monitor?.event_type}
                  </p>
                  {evt.counterfactual && (
                    <div style={{ fontSize: 11, color: 'var(--text-sec)', lineHeight: 1.5 }}>
                      <p><span className="label">Actual:</span> {evt.counterfactual.actual_outcome}</p>
                      <p><span className="label">Variance:</span> {evt.counterfactual.prediction_variance}</p>
                      <p><span className="label">Learning:</span> {evt.counterfactual.learning_signal}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ConfigPanel() {
  const [cfg, setCfg] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.config().then(setCfg).catch(() => {})
  }, [])

  if (!cfg) return null
  const thresholds = cfg.thresholds || {}

  const save = async () => {
    setSaving(true)
    try {
      const updated = await api.updateConfig({
        severity_threshold: Number(thresholds.severity),
        dissent_divergence_threshold: Number(thresholds.dissent_divergence),
        cascade_window_hours: Number(thresholds.cascade_window_hours),
        cascade_overlap_multiplier: Number(thresholds.cascade_overlap_multiplier),
        simulation_sla_seconds: Number(thresholds.simulation_sla_seconds),
        max_validator_reruns: Number(thresholds.max_validator_reruns),
      })
      setCfg(updated.config)
    } catch (e) {}
    setSaving(false)
  }

  return (
    <div className="panel">
      <PanelHeader label="System Configuration" accent="var(--warning)" right={<InfoTooltip title="Pipeline Thresholds" description="Controls the sensitivity of the AI pipeline — the minimum severity to trigger an analysis, how much disagreement between agents triggers a dissent gate, and the time window for detecting compound cascade events." />} />
      <div style={{ padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {Object.entries(thresholds).map(([key, value]) => (
          <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="eyebrow">{key.replaceAll('_', ' ')}</span>
            <input
              value={value}
              onChange={e => setCfg(prev => ({ ...prev, thresholds: { ...prev.thresholds, [key]: e.target.value } }))}
            />
          </label>
        ))}
        <button className="btn btn-primary" onClick={save} disabled={saving} style={{ gridColumn: '1 / -1', marginTop: 4 }}>
          {saving ? 'Saving...' : 'Save Runtime Config'}
        </button>
      </div>
    </div>
  )
}

export function AuditLog() {
  const [entries, setEntries] = useState([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open) {
      api.auditLog().then(setEntries).catch(() => {})
      const t = setInterval(() => api.auditLog().then(setEntries).catch(() => {}), 3000)
      return () => clearInterval(t)
    }
  }, [open])

  return (
    <div className="panel">
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '13px 16px', textAlign: 'left',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          color: 'var(--text-pri)', background: 'transparent', border: 'none',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13, color: 'var(--text-pri)' }}>
          <span style={{ color: 'var(--primary)' }}>{open ? '▾' : '▸'}</span>
          Activity History
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-sec)' }}>
          {open ? `${entries.length} entries` : 'click to view'}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 12px 8px' }}>
          <button
            className="btn btn-sm btn-ghost"
            onClick={async () => {
              const text = await api.auditLogExport()
              const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'audit-log.csv'
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            Export CSV
          </button>
        </div>
      )}
      {open && (
        <div style={{ maxHeight: 240, overflowY: 'auto', padding: '8px 12px', borderTop: '1px solid var(--glass-border)' }}>
          {entries.map((e, i) => (
            <div
              key={e.id || i}
              style={{
                display: 'grid', gridTemplateColumns: '70px 110px 1fr', gap: 8,
                padding: '4px 0', borderBottom: '1px solid var(--glass-border)', fontSize: 10,
              }}
              className="mono"
            >
              <span style={{ color: 'var(--text-dim)' }}>
                {e.timestamp_utc?.split('T')[1]?.slice(0, 8)}
              </span>
              <span style={{ color: 'var(--info)' }}>{e.agent}</span>
              <span style={{ color: 'var(--text-sec)' }}>
                {e.action} · {e.output_summary}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
