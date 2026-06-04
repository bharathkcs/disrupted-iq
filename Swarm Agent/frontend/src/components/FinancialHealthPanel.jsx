import React, { useEffect, useState } from 'react'
import { api } from '../services/api.js'
import { InfoTooltip } from './ui.jsx'

const TIER_STYLE = {
  Critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.32)' },
  'At Risk': { color: '#f97316', bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.32)' },
  Watch:     { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.30)' },
  Stable:    { color: '#22c55e', bg: 'rgba(34,197,94,0.08)',  border: 'rgba(34,197,94,0.28)' },
}

const TIER_ORDER = ['Critical', 'At Risk', 'Watch', 'Stable']

const TIER_META = {
  Critical: {
    verdict: 'Critical — immediate financial risk. Treat as a potential supply failure.',
    isGood: false,
    why: 'A Critical rating reflects high sector-level financial stress combined with operational signals of instability — very low reliability (< 70%), minimal buffer stock, and/or a sector with documented distress. This supplier could face insolvency or sudden capacity loss.',
    action: 'Escalate to procurement leadership immediately. Activate backup suppliers now rather than waiting for a disruption. Request financial health disclosure (latest accounts, payment terms) and set a 30-day review checkpoint.',
  },
  'At Risk': {
    verdict: 'At Risk — elevated financial stress. Monitor closely.',
    isGood: false,
    why: 'At Risk (score 40–59) indicates a combination of sector stress and sub-par operational metrics. While not imminent, this supplier has a meaningfully higher chance of operational disruption than a Stable peer.',
    action: 'Increase monitoring frequency. Qualify at least one alternative supplier in the same category. Request a financial health update and discuss payment-term flexibility if this supplier is strategically important.',
  },
  Watch: {
    verdict: 'Watch — some financial caution warranted. Manageable with attention.',
    isGood: true,
    why: 'Watch (score 60–74) reflects mild sector stress or slightly below-average operational buffers. The supplier is not in immediate danger but shows one or more metrics that warrant periodic review.',
    action: 'Schedule a quarterly supplier health review. Ensure buffer stock from this supplier stays above your minimum threshold. No immediate action needed unless metrics deteriorate further.',
  },
  Stable: {
    verdict: 'Stable — healthy financial profile. Low short-term risk.',
    isGood: true,
    why: 'Stable (score ≥ 75) indicates a sector with low financial stress and strong operational metrics — high reliability, adequate buffer stock, and multi-site production. This supplier is unlikely to face a financial disruption in the near term.',
    action: 'Maintain current monitoring cadence. These suppliers are strong candidates for strategic partnership or preferred-supplier agreements. No corrective action needed.',
  },
}

function Pill({ tier, count }) {
  const ts = TIER_STYLE[tier] || TIER_STYLE.Stable
  return (
    <div style={{ flex: 1, minWidth: 110, padding: '12px 14px', borderRadius: 10, background: ts.bg, border: `1px solid ${ts.border}`, textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{tier}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: ts.color, marginTop: 2 }}>{count}</div>
    </div>
  )
}

function SupplierRow({ record }) {
  const [expanded, setExpanded] = useState(false)
  const tier = record.tier || 'Stable'
  const ts   = TIER_STYLE[tier] || TIER_STYLE.Stable
  const meta = TIER_META[tier]  || TIER_META.Stable
  const bd   = record.breakdown || {}

  return (
    <div style={{ marginBottom: 0 }}>
      {/* Main row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '9px 12px',
        borderRadius: expanded ? '8px 8px 0 0' : 8,
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${ts.border}`,
        borderBottom: expanded ? 'none' : `1px solid ${ts.border}`,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {record.supplier_name}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
            {record.zone || '—'} · {bd.sector || '—'}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: ts.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{tier}</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.1 }}>
            {record.financial_health_score}<span style={{ fontSize: 10, color: '#64748b' }}>/100</span>
          </div>
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            padding: '4px 9px', borderRadius: 5, fontSize: 11, fontWeight: 600,
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            background: expanded ? ts.bg : 'rgba(255,255,255,0.05)',
            border: `1px solid ${expanded ? ts.border : 'rgba(255,255,255,0.12)'}`,
            color: expanded ? ts.color : '#94a3b8',
            transition: 'all 0.15s',
          }}
        >
          {expanded ? '▲ Close' : '▼ Why?'}
        </button>
      </div>

      {/* Expanded explanation */}
      {expanded && (
        <div style={{
          padding: '12px 14px 14px',
          background: ts.bg,
          border: `1px solid ${ts.border}`,
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: meta.isGood ? '#22c55e' : ts.color, marginBottom: 10 }}>
            {meta.verdict}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Why this rating?</div>
              <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.65 }}>{meta.why}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>What you should do</div>
              <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.65 }}>{meta.action}</div>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: '#64748b', borderTop: `1px solid ${ts.border}`, paddingTop: 8 }}>
            Financial health score: <strong style={{ color: ts.color }}>{record.financial_health_score}/100</strong>
            {bd.sector && <span style={{ marginLeft: 12 }}>Sector: <strong style={{ color: '#e2e8f0' }}>{bd.sector}</strong></span>}
            {record.zone  && <span style={{ marginLeft: 12 }}>Zone: <strong style={{ color: '#e2e8f0' }}>{record.zone}</strong></span>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function FinancialHealthPanel() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let alive = true
    api.supplierFinancialHealth()
      .then(res => { if (alive) setData(res) })
      .catch(err => { if (alive) setError(err?.message || 'Failed to load financial health') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  if (loading) return <div className="panel panel-pad"><div style={{ color: '#64748b', fontSize: 13 }}>Loading financial health…</div></div>
  if (error)   return <div className="panel panel-pad"><div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div></div>
  if (!data)   return null

  const suppliers = Array.isArray(data.suppliers) ? data.suppliers : []
  const summary   = data.summary || {}
  const sorted    = [...suppliers].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))

  return (
    <div className="panel panel-pad">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 16 }}>💰</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>Supplier Financial Health</span>
        <InfoTooltip
          title="Inferred financial-health signals"
          description={
            'Combines industry sector stress, operational proxies (reliability + buffer days), and distress signals into a 0–100 score. '
            + 'Stable ≥ 75, Watch 60–74, At Risk 40–59, Critical < 40. '
            + 'Click "Why?" on any row for a rating explanation and action plan.'
          }
        />
      </div>

      {suppliers.length === 0 ? (
        <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(124,107,255,0.07)', border: '1px solid rgba(124,107,255,0.2)', color: '#94a3b8', fontSize: 13, lineHeight: 1.55 }}>
          {data.message || 'No suppliers uploaded yet. Upload suppliers to see financial health analysis.'}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <Pill tier="Critical" count={summary.critical || 0} />
            <Pill tier="At Risk"  count={summary.at_risk  || 0} />
            <Pill tier="Watch"    count={summary.watch    || 0} />
            <Pill tier="Stable"   count={summary.stable   || 0} />
          </div>

          <div
            style={{ maxHeight: 520, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}
            onWheel={e => e.stopPropagation()}
          >
            {sorted.map(record => (
              <SupplierRow key={record.supplier_id || record.supplier_name} record={record} />
            ))}
          </div>

          <div style={{ marginTop: 8, fontSize: 11, color: '#475569', textAlign: 'center' }}>
            All {suppliers.length} suppliers · worst financial health first · scroll to browse · click <strong style={{ color: '#94a3b8' }}>Why?</strong> for rating explanation
          </div>
        </>
      )}
    </div>
  )
}
