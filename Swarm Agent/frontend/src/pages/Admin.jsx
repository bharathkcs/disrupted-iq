import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api.js'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Accounts' },
  { id: 'deleted', label: 'Deleted' },
  { id: 'churned', label: 'Churned' },
  { id: 'surveys', label: 'Surveys' },
  { id: 'premium', label: 'Premium Requests' },
  { id: 'support', label: 'Support' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'activity', label: 'Activity Log' },
  { id: 'ai', label: 'AI Interactions' },
  { id: 'health', label: 'System Health' },
]

const fmt = (ts) => {
  if (!ts) return '—'
  const d = new Date(ts)
  return isNaN(d.getTime()) ? String(ts) : d.toLocaleString()
}

const C = {
  bg: '#0f172a', panel: '#111827', border: '#1e293b',
  text: '#fff', dim: '#9ca3af', sub: '#d1d5db',
  green: '#10b981', blue: '#3b82f6', purple: '#a78bfa', red: '#ef4444', amber: '#f59e0b',
}

function StatCard({ label, value, color = C.green }) {
  return (
    <div className="panel" style={{ padding: 18, borderRadius: 10, background: C.panel, border: `1px solid ${C.border}` }}>
      <p style={{ margin: '0 0 6px', color: C.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
      <p style={{ margin: 0, fontSize: 26, fontWeight: 700, color }}>{value}</p>
    </div>
  )
}

function th(text) {
  return <th style={{ padding: '12px 14px', textAlign: 'left', color: C.dim, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{text}</th>
}
const tdStyle = { padding: '11px 14px', color: C.sub, fontSize: 12.5, borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' }

function StatusBadge({ row }) {
  const map = row.suspended
    ? { bg: 'rgba(239,68,68,0.18)', fg: '#fca5a5', text: 'Suspended' }
    : row.is_admin
      ? { bg: 'rgba(168,85,247,0.18)', fg: C.purple, text: 'Owner' }
      : row.is_seed
        ? { bg: 'rgba(59,130,246,0.18)', fg: '#93c5fd', text: 'Demo' }
        : { bg: 'rgba(16,185,129,0.18)', fg: '#86efac', text: 'Active' }
  return <span style={{ display: 'inline-block', padding: '3px 9px', background: map.bg, color: map.fg, borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{map.text}</span>
}

export default function Admin() {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [denied, setDenied] = useState(false)
  const [tab, setTab] = useState('overview')
  const [error, setError] = useState(null)
  const [busyClient, setBusyClient] = useState(null)

  const [overview, setOverview] = useState(null)
  const [users, setUsers] = useState(null)
  const [activity, setActivity] = useState(null)
  const [ai, setAi] = useState(null)
  const [health, setHealth] = useState(null)
  const [premium, setPremium] = useState(null)
  const [support, setSupport] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [busyReq, setBusyReq] = useState(null)
  const [replyDraft, setReplyDraft] = useState({})
  const [replyResolved, setReplyResolved] = useState({})
  const [busyTicket, setBusyTicket] = useState(null)
  const [deleted, setDeleted] = useState(null)
  const [busyDelete, setBusyDelete] = useState(null)
  const [selfDeletions, setSelfDeletions] = useState(null)
  const [surveys, setSurveys] = useState(null)

  // Gate: try the overview endpoint. Non-owners get 404 -> redirect away silently.
  useEffect(() => {
    let active = true
    api.adminOverview()
      .then(data => { if (active) { setOverview(data); setChecking(false) } })
      .catch(() => { if (active) { setDenied(true); setChecking(false); navigate('/dashboard', { replace: true }) } })
    return () => { active = false }
  }, [navigate])

  const refreshOverview = useCallback(async () => {
    try { setOverview(await api.adminOverview()) } catch (_) {}
  }, [])

  const loadTab = useCallback(async (t) => {
    setError(null)
    try {
      if (t === 'overview') setOverview(await api.adminOverview())
      else if (t === 'users') setUsers((await api.adminUsers()).users || [])
      else if (t === 'deleted') setDeleted((await api.adminDeletedAccounts()).accounts || [])
      else if (t === 'churned') setSelfDeletions((await api.adminSelfDeletions()).deletions || [])
      else if (t === 'surveys') setSurveys(await api.adminSurveys())
      else if (t === 'premium') setPremium(await api.adminPremiumRequests())
      else if (t === 'support') setSupport((await api.adminSupport()).tickets || [])
      else if (t === 'feedback') setFeedback(await api.adminFeedback())
      else if (t === 'activity') setActivity((await api.adminActivity(300)).activity || [])
      else if (t === 'ai') setAi((await api.adminAiInteractions(300)).interactions || [])
      else if (t === 'health') setHealth(await api.adminSystemHealth())
    } catch (err) {
      setError(err.message || 'Failed to load')
    }
  }, [])

  useEffect(() => { if (!checking && !denied) loadTab(tab) }, [tab, checking, denied, loadTab])

  const refreshUsers = async () => { try { setUsers((await api.adminUsers()).users || []) } catch (e) { setError(e.message) } }

  const toggleSuspend = async (row) => {
    const action = row.suspended ? 'reactivate' : 'suspend'
    if (!window.confirm(`${action === 'suspend' ? 'Suspend' : 'Reactivate'} account for "${row.company_name}"?`)) return
    setBusyClient(row.client_id)
    try {
      if (row.suspended) await api.adminReactivateUser(row.client_id)
      else await api.adminSuspendUser(row.client_id)
      await Promise.all([refreshUsers(), refreshOverview()])
    } catch (err) {
      setError(err.message || 'Action failed')
    } finally {
      setBusyClient(null)
    }
  }

  const decidePremium = async (id, approve) => {
    setBusyReq(id)
    try {
      if (approve) await api.adminApprovePremium(id)
      else await api.adminDenyPremium(id)
      const [pr] = await Promise.all([api.adminPremiumRequests(), refreshOverview()])
      setPremium(pr)
    } catch (err) {
      setError(err.message || 'Action failed')
    } finally {
      setBusyReq(null)
    }
  }

  const revokePremium = async (clientId) => {
    if (!window.confirm('Revoke Premium access for this account? They will be limited to 30 suppliers again.')) return
    setBusyReq(clientId)
    try {
      await api.adminRevokePremium(clientId)
      const [pr] = await Promise.all([api.adminPremiumRequests(), refreshOverview()])
      setPremium(pr)
    } catch (err) {
      setError(err.message || 'Action failed')
    } finally {
      setBusyReq(null)
    }
  }

  const sendReply = async (ticket) => {
    const tid = ticket.ticket_id
    const message = (replyDraft[tid] || '').trim()
    if (!message) { setError('Enter a response message first.'); return }
    setBusyTicket(tid)
    try {
      await api.adminRespondSupport(tid, { message, resolved: !!replyResolved[tid] })
      setReplyDraft(d => ({ ...d, [tid]: '' }))
      setSupport((await api.adminSupport()).tickets || [])
    } catch (err) {
      setError(err.message || 'Could not send reply')
    } finally {
      setBusyTicket(null)
    }
  }

  const applyPremiumAction = async (r, action) => {
    if (!action) return
    setBusyReq(r.id)
    try {
      if (action === 'grant') await api.adminGrantPremium(r.client_id)
      else if (action === 'revoke') await api.adminRevokePremium(r.client_id)
      else if (action === 'deny') await api.adminDenyPremium(r.id)
      setPremium(await api.adminPremiumRequests())
    } catch (err) {
      setError(err.message || 'Action failed')
    } finally {
      setBusyReq(null)
    }
  }

  const deleteAccount = async (row) => {
    if (!window.confirm(`Delete "${row.company_name}"?\n\nIt will move to the Deleted tab and be permanently removed after 48 hours unless you restore it.`)) return
    setBusyClient(row.client_id)
    try {
      await api.adminDeleteAccount(row.client_id)
      await refreshUsers()
    } catch (err) {
      setError(err.message || 'Delete failed')
    } finally {
      setBusyClient(null)
    }
  }

  const restoreAccount = async (clientId) => {
    setBusyDelete(clientId)
    try {
      await api.adminRestoreAccount(clientId)
      setDeleted((await api.adminDeletedAccounts()).accounts || [])
    } catch (err) {
      setError(err.message || 'Restore failed')
    } finally {
      setBusyDelete(null)
    }
  }

  if (checking) {
    return <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dim }}>Verifying access…</div>
  }
  if (denied) return null

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 16px', minHeight: '100vh', background: C.bg }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: '0 0 6px', color: C.text, fontSize: 28, fontWeight: 700 }}>🛡 Admin Console</h1>
        <p style={{ margin: 0, color: C.dim, fontSize: 13 }}>Owner-only platform monitoring · analytics, audit trails, and access control</p>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '10px 18px', border: 'none', background: 'transparent', cursor: 'pointer',
              color: tab === t.id ? C.text : C.dim, fontSize: 13, fontWeight: 600,
              borderBottom: tab === t.id ? `2px solid ${C.purple}` : '2px solid transparent',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: `1px solid ${C.red}`, color: '#fca5a5', padding: '12px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>⚠️ {error}</div>
      )}

      {tab === 'overview' && overview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
            <StatCard label="Total Accounts" value={overview.totals.clients} color={C.green} />
            <StatCard label="Users" value={overview.totals.users} color={C.blue} />
            <StatCard label="Suppliers Tracked" value={overview.totals.suppliers} color={C.purple} />
            <StatCard label="Events Run" value={overview.totals.events} color={C.amber} />
            <StatCard label="Active Sessions" value={overview.totals.active_sessions} color={C.green} />
            <StatCard label="AI Interactions" value={overview.totals.ai_interactions} color={C.blue} />
            <StatCard label="Feedback" value={overview.totals.feedback} color={C.purple} />
            <StatCard label="Support Tickets" value={overview.totals.support_tickets} color={C.amber} />
            <StatCard label="Suspended" value={overview.totals.suspended_accounts} color={C.red} />
            <StatCard label="Premium Accounts" value={overview.totals.premium_accounts ?? 0} color={C.amber} />
            <StatCard label="Pending Premium" value={overview.totals.pending_premium_requests ?? 0} color={C.purple} />
            <StatCard label="Churned (Self-Deleted)" value={overview.totals.self_deletions ?? 0} color={C.red} />
            <StatCard label="Survey Responses" value={overview.totals.survey_responses ?? 0} color={C.blue} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <StatCard label="Signups Today" value={overview.signups.today} color={C.green} />
            <StatCard label="Signups (7 days)" value={overview.signups.last_7_days} color={C.blue} />
            <StatCard label="Avg Suppliers / Account" value={overview.avg_suppliers_per_client} color={C.purple} />
            <StatCard label="AI Queries Today" value={overview.ai_interactions_today} color={C.amber} />
          </div>

          <div className="panel" style={{ padding: 18, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10 }}>
            <h3 style={{ margin: '0 0 14px', color: C.sub, fontSize: 14, fontWeight: 700 }}>Accounts by Industry</h3>
            {(overview.industries || []).length === 0 && <p style={{ color: C.dim, fontSize: 13 }}>No data yet.</p>}
            {(overview.industries || []).map(row => {
              const max = overview.industries[0]?.count || 1
              return (
                <div key={row.industry} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <span style={{ width: 140, color: C.sub, fontSize: 12.5, textTransform: 'capitalize' }}>{row.industry}</span>
                  <div style={{ flex: 1, background: C.border, borderRadius: 4, height: 16, overflow: 'hidden' }}>
                    <div style={{ width: `${(row.count / max) * 100}%`, height: '100%', background: `linear-gradient(90deg, ${C.blue}, ${C.purple})` }} />
                  </div>
                  <span style={{ width: 30, textAlign: 'right', color: C.text, fontSize: 12.5, fontWeight: 600 }}>{row.count}</span>
                </div>
              )
            })}
          </div>
          <p style={{ color: C.dim, fontSize: 11, margin: 0 }}>Generated {fmt(overview.generated_at)}</p>
        </div>
      )}

      {tab === 'users' && (
        <div className="panel" style={{ overflow: 'hidden', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10 }}>
          {!users && <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>Loading accounts…</div>}
          {users && users.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>No accounts yet.</div>}
          {users && users.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: `2px solid ${C.border}` }}>
                  {th('Company')}{th('Email')}{th('Industry')}{th('Suppliers')}{th('Events')}{th('AI')}{th('Created')}{th('Last Active')}{th('Status')}{th('Action')}
                </tr></thead>
                <tbody>
                  {users.map(row => (
                    <tr key={row.client_id}>
                      <td style={{ ...tdStyle, color: C.text, fontWeight: 600 }}>
                        {row.company_name}
                        {row.premium && <span style={{ marginLeft: 6, display: 'inline-block', padding: '1px 7px', borderRadius: 10, background: 'rgba(250,204,21,0.18)', color: '#fcd34d', fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', verticalAlign: 'middle' }}>★ PRO</span>}
                        {row.used_sample_dataset && <span style={{ marginLeft: 6, display: 'inline-block', padding: '1px 7px', borderRadius: 10, background: 'rgba(45,212,191,0.15)', color: '#2dd4bf', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', verticalAlign: 'middle' }}>Sample Data</span>}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11.5 }}>{row.email || '—'}</td>
                      <td style={{ ...tdStyle, textTransform: 'capitalize' }}>{row.industry}</td>
                      <td style={tdStyle}>{row.supplier_count}</td>
                      <td style={tdStyle}>{row.event_count}</td>
                      <td style={tdStyle}>{row.ai_interaction_count}</td>
                      <td style={{ ...tdStyle, fontSize: 11.5 }}>{fmt(row.created_at)}</td>
                      <td style={{ ...tdStyle, fontSize: 11.5 }}>{fmt(row.last_active)}</td>
                      <td style={tdStyle}><StatusBadge row={row} /></td>
                      <td style={tdStyle}>
                        {row.is_seed || row.is_admin ? (
                          <span style={{ color: C.dim, fontSize: 11 }}>—</span>
                        ) : (
                          <span style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => toggleSuspend(row)} disabled={busyClient === row.client_id}
                              style={{
                                padding: '5px 11px', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11.5, fontWeight: 600,
                                background: row.suspended ? 'rgba(16,185,129,0.18)' : 'rgba(245,158,11,0.18)',
                                color: row.suspended ? '#86efac' : '#fcd34d', opacity: busyClient === row.client_id ? 0.5 : 1,
                              }}>
                              {busyClient === row.client_id ? '…' : row.suspended ? 'Reactivate' : 'Suspend'}
                            </button>
                            <button onClick={() => deleteAccount(row)} disabled={busyClient === row.client_id}
                              style={{
                                padding: '5px 11px', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11.5, fontWeight: 600,
                                background: 'rgba(239,68,68,0.2)', color: '#fca5a5', opacity: busyClient === row.client_id ? 0.5 : 1,
                              }}>
                              Delete
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'activity' && (
        <div className="panel" style={{ overflow: 'hidden', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10 }}>
          {!activity && <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>Loading activity…</div>}
          {activity && activity.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>No activity recorded.</div>}
          {activity && activity.length > 0 && (
            <div style={{ overflowX: 'auto', maxHeight: '70vh' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: `2px solid ${C.border}`, position: 'sticky', top: 0, background: C.panel }}>
                  {th('Time')}{th('Account')}{th('Agent')}{th('Action')}{th('Status')}{th('Detail')}
                </tr></thead>
                <tbody>
                  {activity.map(row => (
                    <tr key={row.id}>
                      <td style={{ ...tdStyle, fontSize: 11.5, whiteSpace: 'nowrap' }}>{fmt(row.timestamp_utc)}</td>
                      <td style={{ ...tdStyle, color: C.text }}>{row.company_name}</td>
                      <td style={tdStyle}>{row.agent}</td>
                      <td style={{ ...tdStyle, color: C.purple }}>{row.action}</td>
                      <td style={{ ...tdStyle, color: row.status === 'DENIED' ? '#fca5a5' : C.sub }}>{row.status}</td>
                      <td style={{ ...tdStyle, maxWidth: 360 }}>{row.output_summary || row.input_summary || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'ai' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!ai && <div className="panel" style={{ padding: 40, textAlign: 'center', color: C.dim, background: C.panel, borderRadius: 10 }}>Loading AI interactions…</div>}
          {ai && ai.length === 0 && <div className="panel" style={{ padding: 40, textAlign: 'center', color: C.dim, background: C.panel, borderRadius: 10 }}>No AI assistant interactions yet.</div>}
          {ai && ai.map(row => (
            <div key={row.id} className="panel" style={{ padding: 16, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{row.company_name}</span>
                <span style={{ color: C.dim, fontSize: 11.5 }}>{fmt(row.timestamp_utc)} · {row.agent_context || 'general'}</span>
              </div>
              <div style={{ color: C.sub, fontSize: 13, marginBottom: 6 }}><strong style={{ color: C.blue }}>Q:</strong> {row.question}</div>
              <div style={{ color: C.dim, fontSize: 12.5, lineHeight: 1.6 }}><strong style={{ color: C.green }}>A:</strong> {row.response}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'deleted' && (
        <div className="panel" style={{ overflow: 'hidden', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10 }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, color: C.dim, fontSize: 12 }}>
            Soft-deleted accounts. Restore within the 48-hour window — after that they are permanently removed and cannot be recovered.
          </div>
          {!deleted && <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>Loading…</div>}
          {deleted && deleted.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>No deleted accounts.</div>}
          {deleted && deleted.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: `2px solid ${C.border}` }}>
                  {th('Company')}{th('Email')}{th('Deleted')}{th('By')}{th('Time left')}{th('Action')}
                </tr></thead>
                <tbody>
                  {deleted.map(a => (
                    <tr key={a.client_id}>
                      <td style={{ ...tdStyle, color: C.text, fontWeight: 600 }}>{a.company_name}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11.5 }}>{a.email || '—'}</td>
                      <td style={{ ...tdStyle, fontSize: 11.5 }}>{fmt(a.deleted_at)}</td>
                      <td style={{ ...tdStyle, fontSize: 11.5 }}>{a.deleted_by || '—'}</td>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 700, color: (a.hours_left != null && a.hours_left < 6) ? '#fca5a5' : '#fcd34d' }}>
                          {a.hours_left != null ? `${a.hours_left}h left` : '—'}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <button onClick={() => restoreAccount(a.client_id)} disabled={busyDelete === a.client_id}
                          style={{ padding: '5px 12px', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11.5, fontWeight: 600, background: 'rgba(16,185,129,0.2)', color: '#86efac', opacity: busyDelete === a.client_id ? 0.5 : 1 }}>
                          {busyDelete === a.client_id ? '…' : '↺ Restore'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'churned' && (
        <div className="panel" style={{ overflow: 'hidden', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10 }}>
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>Self-Deleted Accounts</div>
              <div style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>Users who deleted their own account — with the reason they gave.</div>
            </div>
            <span style={{ color: C.red, fontWeight: 700, fontSize: 20 }}>{selfDeletions ? selfDeletions.length : '—'}</span>
          </div>
          {!selfDeletions && <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>Loading…</div>}
          {selfDeletions && selfDeletions.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>No self-deletions yet.</div>}
          {selfDeletions && selfDeletions.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: `2px solid ${C.border}` }}>
                  {th('Company')}{th('Email')}{th('Reason')}{th('Plan')}{th('Suppliers')}{th('Events')}{th('Deleted')}
                </tr></thead>
                <tbody>
                  {selfDeletions.map((d, i) => (
                    <tr key={i}>
                      <td style={{ ...tdStyle, color: C.text, fontWeight: 600 }}>{d.company_name || '—'}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11.5 }}>{d.email || '—'}</td>
                      <td style={tdStyle}>
                        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 5, fontSize: 11.5, fontWeight: 600,
                          background: d.reason ? 'rgba(239,68,68,0.12)' : 'rgba(107,114,128,0.15)',
                          color: d.reason ? '#fca5a5' : C.dim }}>
                          {d.reason_label || d.reason || 'Not specified'}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        {d.was_premium
                          ? <span style={{ color: '#fcd34d', fontWeight: 700, fontSize: 11.5 }}>★ PRO</span>
                          : <span style={{ color: C.dim, fontSize: 11.5 }}>Free</span>}
                      </td>
                      <td style={tdStyle}>{d.supplier_count ?? '—'}</td>
                      <td style={tdStyle}>{d.event_count ?? '—'}</td>
                      <td style={{ ...tdStyle, fontSize: 11.5, whiteSpace: 'nowrap' }}>{fmt(d.deleted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'surveys' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!surveys && <div className="panel" style={{ padding: 40, textAlign: 'center', color: C.dim, background: C.panel, borderRadius: 10 }}>Loading survey responses…</div>}
          {surveys && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
                <StatCard label="Total Responses" value={surveys.total} color={C.blue} />
                <StatCard label="Left an Email" value={surveys.with_email} color={C.green} />
                <StatCard label="Distinct Roles" value={(surveys.by_role || []).length} color={C.purple} />
                <StatCard label="Distinct Challenges" value={(surveys.by_challenge || []).length} color={C.amber} />
              </div>

              {surveys.total > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                  {[['Top Challenges', surveys.by_challenge, C.amber], ['Most-wanted Features', surveys.by_feature, C.green], ['Roles', surveys.by_role, C.purple]].map(([title, data, col]) => (
                    <div key={title} className="panel" style={{ padding: 16, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10 }}>
                      <h3 style={{ margin: '0 0 12px', color: C.sub, fontSize: 13, fontWeight: 700 }}>{title}</h3>
                      {(data || []).length === 0 && <p style={{ color: C.dim, fontSize: 12 }}>No data.</p>}
                      {(data || []).slice(0, 6).map(row => {
                        const max = (data[0]?.count) || 1
                        return (
                          <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
                            <span style={{ flex: '0 0 130px', color: C.sub, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
                            <div style={{ flex: 1, background: C.border, borderRadius: 4, height: 12, overflow: 'hidden' }}>
                              <div style={{ width: `${(row.count / max) * 100}%`, height: '100%', background: col }} />
                            </div>
                            <span style={{ width: 24, textAlign: 'right', color: C.text, fontSize: 12, fontWeight: 600 }}>{row.count}</span>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}

              <div className="panel" style={{ overflow: 'hidden', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10 }}>
                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, color: C.dim, fontSize: 12 }}>
                  Product-survey responses submitted from the public landing page. Reach out to anyone who left an email.
                </div>
                {surveys.responses.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>No survey responses yet.</div>}
                {surveys.responses.length > 0 && (
                  <div style={{ overflowX: 'auto', maxHeight: '70vh' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr style={{ borderBottom: `2px solid ${C.border}`, position: 'sticky', top: 0, background: C.panel }}>
                        {th('Submitted')}{th('Role')}{th('Biggest Challenge')}{th('Wanted Feature')}{th('Comment')}{th('Email')}
                      </tr></thead>
                      <tbody>
                        {surveys.responses.map((r, i) => (
                          <tr key={r.id || i}>
                            <td style={{ ...tdStyle, fontSize: 11.5, whiteSpace: 'nowrap' }}>{fmt(r.created_at)}</td>
                            <td style={{ ...tdStyle, color: C.text }}>{r.role || '—'}</td>
                            <td style={tdStyle}>{r.challenge || '—'}</td>
                            <td style={{ ...tdStyle, color: C.purple }}>{r.feature || '—'}</td>
                            <td style={{ ...tdStyle, maxWidth: 320, whiteSpace: 'pre-wrap' }}>{r.comment || '—'}</td>
                            <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11.5 }}>
                              {r.email
                                ? <a href={`mailto:${r.email}?subject=DisruptIQ — following up on your survey`} style={{ color: '#93c5fd', textDecoration: 'none' }}>{r.email}</a>
                                : <span style={{ color: C.dim }}>—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'premium' && (
        <div className="panel" style={{ overflow: 'hidden', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10 }}>
          {!premium && <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>Loading requests…</div>}
          {premium && premium.requests.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>No premium requests yet.</div>}
          {premium && premium.requests.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: `2px solid ${C.border}` }}>
                  {th('Company')}{th('Email')}{th('Suppliers')}{th('Requested')}{th('Status')}{th('Action')}
                </tr></thead>
                <tbody>
                  {premium.requests.map(r => (
                    <tr key={r.id}>
                      <td style={{ ...tdStyle, color: C.text, fontWeight: 600 }}>{r.company_name}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11.5 }}>{r.email}</td>
                      <td style={tdStyle}>{r.supplier_count}</td>
                      <td style={{ ...tdStyle, fontSize: 11.5 }}>{fmt(r.requested_at)}</td>
                      <td style={tdStyle}>
                        <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                          background: r.status === 'approved' ? 'rgba(16,185,129,0.18)' : r.status === 'denied' ? 'rgba(239,68,68,0.18)' : 'rgba(245,158,11,0.18)',
                          color: r.status === 'approved' ? '#86efac' : r.status === 'denied' ? '#fca5a5' : '#fcd34d' }}>{r.status}</span>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: r.current_premium ? '#86efac' : C.dim }}>
                            {r.current_premium ? '● Premium active' : '○ Free plan'}
                          </span>
                          <select
                            value=""
                            disabled={busyReq === r.id}
                            onChange={e => applyPremiumAction(r, e.target.value)}
                            style={{ background: '#0b1020', color: C.text, border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 11.5, padding: '5px 8px', cursor: 'pointer', minWidth: 150 }}
                          >
                            <option value="">{busyReq === r.id ? 'Working…' : 'Choose action…'}</option>
                            {!r.current_premium && <option value="grant">✓ Give Premium access</option>}
                            {r.current_premium && <option value="revoke">⛔ Block / Revoke access</option>}
                            {r.status === 'pending' && <option value="deny">✕ Deny request</option>}
                          </select>
                          {r.decided_by && <span style={{ color: C.dim, fontSize: 10 }}>last by {r.decided_by}</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'support' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!support && <div className="panel" style={{ padding: 40, textAlign: 'center', color: C.dim, background: C.panel, borderRadius: 10 }}>Loading tickets…</div>}
          {support && support.length === 0 && <div className="panel" style={{ padding: 40, textAlign: 'center', color: C.dim, background: C.panel, borderRadius: 10 }}>No support tickets.</div>}
          {support && support.map((t, i) => {
            const tid = t.ticket_id || `idx-${i}`
            const status = t.status || 'open'
            return (
            <div key={tid} className="panel" style={{ padding: 16, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{t.company_name} · <span style={{ color: C.purple }}>{t.category}</span></span>
                <span style={{ color: C.dim, fontSize: 11.5 }}>{tid} · {fmt(t.created_at)}</span>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 600,
                  background: status === 'resolved' ? 'rgba(16,185,129,0.18)' : status === 'responded' ? 'rgba(59,130,246,0.18)' : 'rgba(245,158,11,0.18)',
                  color: status === 'resolved' ? '#86efac' : status === 'responded' ? '#93c5fd' : '#fcd34d' }}>{status}</span>
                <span style={{ color: C.dim, fontSize: 11 }}>Priority: <strong style={{ color: (t.priority === 'high' || t.priority === 'urgent') ? '#fca5a5' : C.sub }}>{t.priority || 'normal'}</strong></span>
              </div>
              <div style={{ color: C.sub, fontSize: 13, lineHeight: 1.6, marginBottom: 10 }}>{t.description}</div>
              {t.admin_response && (
                <div style={{ padding: '10px 12px', background: 'rgba(124,107,255,0.08)', borderLeft: `3px solid ${C.purple}`, borderRadius: 6, marginBottom: 10 }}>
                  <div style={{ color: C.dim, fontSize: 11, marginBottom: 3 }}>Your reply{t.responded_by ? ` · ${t.responded_by}` : ''} · {fmt(t.responded_at)}</div>
                  <div style={{ color: C.sub, fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{t.admin_response}</div>
                </div>
              )}
              <textarea
                value={replyDraft[tid] || ''}
                onChange={e => setReplyDraft(d => ({ ...d, [tid]: e.target.value }))}
                placeholder="Write a workaround / response to the customer…"
                rows={3}
                style={{ width: '100%', boxSizing: 'border-box', background: '#0b1020', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 12.5, padding: 10, resize: 'vertical', fontFamily: 'inherit' }}
              />
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <button onClick={() => sendReply(t)} disabled={busyTicket === tid}
                  style={{ padding: '7px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, background: C.purple, color: '#fff', opacity: busyTicket === tid ? 0.5 : 1 }}>
                  {busyTicket === tid ? 'Sending…' : 'Send reply'}
                </button>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: C.sub, fontSize: 12.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!replyResolved[tid]} onChange={e => setReplyResolved(r => ({ ...r, [tid]: e.target.checked }))} />
                  Mark as resolved
                </label>
              </div>
            </div>
          )})}
        </div>
      )}

      {tab === 'feedback' && feedback && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="panel" style={{ padding: 16, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10 }}>
            <span style={{ color: C.dim, fontSize: 12 }}>Average rating</span>
            <div style={{ color: C.amber, fontSize: 24, fontWeight: 700 }}>{feedback.avg_rating} ★ <span style={{ color: C.dim, fontSize: 13, fontWeight: 400 }}>({feedback.total})</span></div>
          </div>
          {feedback.feedback.length === 0 && <div className="panel" style={{ padding: 40, textAlign: 'center', color: C.dim, background: C.panel, borderRadius: 10 }}>No feedback yet.</div>}
          {feedback.feedback.map((f, i) => (
            <div key={i} className="panel" style={{ padding: 16, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{f.company_name}</span>
                <span style={{ color: C.amber, fontSize: 13 }}>{'★'.repeat(Math.round(f.rating || 0))}<span style={{ color: C.border }}>{'★'.repeat(Math.max(0, 5 - Math.round(f.rating || 0)))}</span> · <span style={{ color: C.dim }}>{fmt(f.created_at)}</span></span>
              </div>
              {f.comment && <div style={{ color: C.sub, fontSize: 13, lineHeight: 1.6 }}>{f.comment}</div>}
            </div>
          ))}
        </div>
      )}

      {tab === 'health' && health && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="panel" style={{ padding: 18, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10 }}>
            <h3 style={{ margin: '0 0 14px', color: C.sub, fontSize: 14, fontWeight: 700 }}>Service Flags {health.demo_mode && <span style={{ color: C.amber, fontSize: 12 }}>· DEMO MODE</span>}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              {Object.entries(health.flags).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: v ? C.green : '#6b7280' }} />
                  <span style={{ color: C.sub, fontSize: 12.5 }}>{k.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
            {Object.entries(health.store_sizes).map(([k, v]) => (
              <StatCard key={k} label={k.replace(/_/g, ' ')} value={v} color={C.blue} />
            ))}
          </div>
          <p style={{ color: C.dim, fontSize: 11, margin: 0 }}>Generated {fmt(health.generated_at)}</p>
        </div>
      )}
    </div>
  )
}
