import React, { useEffect, useState } from 'react'
import { api } from '../services/api.js'
import { InfoTooltip } from './ui.jsx'

const TIER_STYLE = {
  A: { color: '#22c55e', bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.32)',  label: 'A · Best-in-class' },
  B: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.32)', label: 'B · Good' },
  C: { color: '#f97316', bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.32)', label: 'C · Watch' },
  D: { color: '#ef4444', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.32)',  label: 'D · High ESG risk' },
}

const TIER_ORDER = ['D', 'C', 'B', 'A']

const TIER_META = {
  A: {
    verdict: 'Excellent — best-in-class ESG profile.',
    isGood: true,
    why: 'Tier A (score ≥ 80/100) is awarded when the supplier\'s industry carries low carbon intensity, the geographic zone has minimal climate risk, and the sector has a strong labour and governance track record. All three pillars score well above average.',
    action: 'No urgent action needed. Monitor annually and request ISO 14001 or SA8000 certification evidence to formally verify and lock in this rating.',
  },
  B: {
    verdict: 'Good — acceptable ESG profile with room to improve.',
    isGood: true,
    why: 'Tier B (65–79) indicates moderate carbon or climate exposure, or minor labour/governance concerns. The supplier is not high-risk but sits below the best-in-class threshold due to one or more weaker pillars.',
    action: 'Request a carbon-reduction roadmap from this supplier and ask for relevant certifications within 12 months. Targeted improvement here can move this supplier to Tier A.',
  },
  C: {
    verdict: 'Watch — elevated ESG risk. Action recommended within 6 months.',
    isGood: false,
    why: 'Tier C (45–64) reflects a high-carbon industry, a climate-exposed zone (e.g., coastal, flood-prone), or documented labour and governance concerns in the sector. The risk is real but manageable with active engagement.',
    action: 'Send a formal ESG questionnaire. Set a 6-month timeline for improvement — emissions targets, labour audit, or third-party certification. Identify at least one Tier-A or Tier-B alternative supplier as a contingency.',
  },
  D: {
    verdict: 'High risk — urgent ESG review required immediately.',
    isGood: false,
    why: 'Tier D (< 45) signals high carbon intensity, significant climate vulnerability, and/or known labour or governance red flags in the supplier\'s sector and zone. Continuing without mitigation carries reputational and regulatory exposure.',
    action: 'Escalate to procurement leadership. Commission an independent supplier audit. Begin qualifying alternative suppliers immediately. Issue a time-bound improvement plan with exit clauses if targets are not met within 90 days.',
  },
}

function Pill({ tier, count }) {
  const ts = TIER_STYLE[tier] || TIER_STYLE.D
  return (
    <div style={{ flex: 1, minWidth: 110, padding: '12px 14px', borderRadius: 10, background: ts.bg, border: `1px solid ${ts.border}`, textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{ts.label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: ts.color, marginTop: 2 }}>{count}</div>
    </div>
  )
}

function SupplierRow({ record }) {
  const [expanded, setExpanded] = useState(false)
  const tier      = record.tier || 'D'
  const ts        = TIER_STYLE[tier] || TIER_STYLE.D
  const meta      = TIER_META[tier]  || TIER_META.D
  const bd        = record.breakdown || {}

  return (
    <div style={{ marginBottom: 0 }}>
      {/* Main row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 12px', borderRadius: expanded ? '8px 8px 0 0' : 8,
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${ts.border}`,
        borderBottom: expanded ? 'none' : `1px solid ${ts.border}`,
      }}>
        {/* Name + sub */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {record.supplier_name}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
            {bd.industry || '—'} · {bd.zone || record.zone || '—'}
          </div>
        </div>
        {/* Score pills */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: '#64748b' }} title="Carbon intensity score">C:<strong style={{ color: '#cbd5e1' }}>{bd.carbon_score ?? '—'}</strong></span>
          <span style={{ fontSize: 10, color: '#64748b' }} title="Climate risk score">Cl:<strong style={{ color: '#cbd5e1' }}>{bd.climate_score ?? '—'}</strong></span>
          <span style={{ fontSize: 10, color: '#64748b' }} title="Labour/governance score">L:<strong style={{ color: '#cbd5e1' }}>{bd.labor_score ?? '—'}</strong></span>
        </div>
        {/* Tier badge + composite */}
        <div style={{ textAlign: 'right', minWidth: 68, flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: ts.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>TIER {tier}</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.1 }}>
            {record.esg_composite}<span style={{ fontSize: 10, color: '#64748b' }}>/100</span>
          </div>
        </div>
        {/* Why button */}
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Why this grade?</div>
              <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.65 }}>{meta.why}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>What you should do</div>
              <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.65 }}>{meta.action}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, color: '#64748b', borderTop: `1px solid ${ts.border}`, paddingTop: 8 }}>
            <span>Carbon intensity: <strong style={{ color: '#e2e8f0' }}>{bd.carbon_score ?? '—'}/100</strong></span>
            <span>Climate risk: <strong style={{ color: '#e2e8f0' }}>{bd.climate_score ?? '—'}/100</strong></span>
            <span>Labour/governance: <strong style={{ color: '#e2e8f0' }}>{bd.labor_score ?? '—'}/100</strong></span>
            <span>ESG composite: <strong style={{ color: ts.color }}>{record.esg_composite}/100</strong></span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ESGPanel() {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    let alive = true
    api.supplierEsg()
      .then(res => { if (alive) setData(res) })
      .catch(err => { if (alive) setError(err?.message || 'Failed to load ESG analysis') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  if (loading) return <div className="panel panel-pad"><div style={{ color: '#64748b', fontSize: 13 }}>Loading ESG analysis…</div></div>
  if (error)   return <div className="panel panel-pad"><div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div></div>
  if (!data)   return null

  const suppliers = Array.isArray(data.suppliers) ? data.suppliers : []
  const summary   = data.summary || {}
  const sorted    = [...suppliers].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))

  return (
    <div className="panel panel-pad">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 16 }}>🌱</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>ESG &amp; Compliance Risk</span>
        <InfoTooltip
          title="Environmental, Social, Governance scoring"
          description={
            'Combines industry carbon intensity, zone climate risk, and labour/governance risk into a 0–100 ESG composite. '
            + 'Tier A ≥ 80 (best), B = 65–79 (good), C = 45–64 (watch), D < 45 (high risk). '
            + 'Click "Why?" on any row for a full grade explanation and action plan.'
          }
        />
        {suppliers.length > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b' }}>
            Portfolio avg: <strong style={{ color: '#f1f5f9' }}>{summary.avg_composite}/100</strong>
            <span style={{ marginLeft: 6 }}>· {suppliers.length} suppliers</span>
          </span>
        )}
      </div>

      {suppliers.length === 0 ? (
        <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(124,107,255,0.07)', border: '1px solid rgba(124,107,255,0.2)', color: '#94a3b8', fontSize: 13, lineHeight: 1.55 }}>
          {data.message || 'No suppliers uploaded yet. Upload suppliers to see ESG analysis.'}
        </div>
      ) : (
        <>
          {/* Tier summary pills */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <Pill tier="A" count={summary.A || 0} />
            <Pill tier="B" count={summary.B || 0} />
            <Pill tier="C" count={summary.C || 0} />
            <Pill tier="D" count={summary.D || 0} />
          </div>

          {/* Scrollable supplier list */}
          <div
            style={{ maxHeight: 520, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}
            onWheel={e => e.stopPropagation()}
          >
            {sorted.map(record => (
              <SupplierRow key={record.supplier_id || record.supplier_name} record={record} />
            ))}
          </div>

          <div style={{ marginTop: 8, fontSize: 11, color: '#475569', textAlign: 'center' }}>
            All {suppliers.length} suppliers · worst ESG first · scroll to browse · click <strong style={{ color: '#94a3b8' }}>Why?</strong> for grade explanation
          </div>
        </>
      )}
    </div>
  )
}
