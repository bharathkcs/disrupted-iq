import React, { useState } from 'react'
import { PanelHeader, Tag, InfoTooltip } from './ui.jsx'

const ACTION_HELP = {
  title: 'Recommended Actions',
  description: 'Three AI-ranked recovery options for this disruption. Each option includes: Monte Carlo simulation outcomes (P10/P50/P90), Recovery Time Objective (RTO) tag (fast/moderate/slow), and a "Draft Message" button to generate supplier outreach emails. A human must confirm before any action is taken.',
}
import { api } from '../services/api.js'

// ── Feature 4: Supplier Communication Drafter ───────────────────────────────
function SupplierMessagePanel({ eventId, option }) {
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  const generate = async () => {
    setLoading(true); setError(null)
    try {
      const result = await api.supplierMessage({ event_id: eventId, option_rank: option.rank })
      setDraft(result)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const copy = () => {
    if (!draft) return
    const text = `Subject: ${draft.subject}\n\n${draft.body}`
    navigator.clipboard?.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--glass-border)' }}>
      {!draft ? (
        <button className="btn btn-sm btn-ghost" onClick={generate} disabled={loading || !eventId}>
          {loading ? 'Drafting...' : '✉ Draft Notification'}
        </button>
      ) : (
        <div style={{ background: 'var(--bg-deep)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-sm)', padding: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Tag color="var(--info)">{draft.message_type}</Tag>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm" onClick={copy}>{copied ? '✓ Copied' : 'Copy'}</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setDraft(null)}>✕</button>
            </div>
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>
            To: {draft.recipient}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-pri)', marginBottom: 6 }}>
            Subject: {draft.subject}
          </div>
          <pre className="mono" style={{
            fontSize: 10, color: 'var(--text-sec)', whiteSpace: 'pre-wrap',
            lineHeight: 1.6, margin: 0, maxHeight: 220, overflowY: 'auto',
          }}>{draft.body}</pre>
          <div className="mono" style={{ fontSize: 9, color: 'var(--warning)', marginTop: 8, fontStyle: 'italic' }}>
            ⚠ {draft.disclaimer}
          </div>
        </div>
      )}
      {error && (
        <div className="mono" style={{ fontSize: 10, color: 'var(--danger)', marginTop: 6 }}>{error}</div>
      )}
    </div>
  )
}

const URGENCY_COLOR = {
  Immediate: 'var(--danger)',
  Urgent: '#FB923C',
  Medium: 'var(--warning)',
}
// Feature 7 — Recovery Time Objective tier colours
const RTO_TIER_COLOR = {
  fast: 'var(--success)',
  moderate: 'var(--warning)',
  slow: 'var(--danger)',
}
const SCENARIO_COLOR = {
  'Best Case': 'var(--success)',
  'Expected': 'var(--info)',
  'Worst Case': 'var(--danger)',
}

function ScenarioCard({ scenario }) {
  const c = SCENARIO_COLOR[scenario.name] || 'var(--text-sec)'
  return (
    <div
      style={{
        background: 'var(--bg-deep)',
        border: `1px solid ${c}33`,
        borderTop: `2px solid ${c}`,
        padding: 10,
        flex: 1,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span className="eyebrow" style={{ color: c }}>{scenario.name}</span>
        <span className="digits" style={{ color: c, fontSize: 18 }}>
          {scenario.probability}<span className="mono" style={{ fontSize: 10 }}>%</span>
        </span>
      </div>
      <p className="mono" style={{ fontSize: 10, color: 'var(--text-pri)', lineHeight: 1.5, marginBottom: 6 }}>
        {scenario.outcome}
      </p>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }} className="mono">
        <span style={{ color: 'var(--text-dim)' }}>{scenario.delivery_timing}</span>
        <span style={{ color: scenario.cost_deviation_pct > 0 ? 'var(--warning)' : 'var(--success)' }}>
          {scenario.cost_deviation_pct > 0 ? `+${scenario.cost_deviation_pct}%` : 'no Δ'}
        </span>
      </div>
      {scenario.key_assumption && (
        <p
          className="mono"
          style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 6, fontStyle: 'italic' }}
        >
          assumption: {scenario.key_assumption}
        </p>
      )}
    </div>
  )
}

const PERSONA_LABEL = {
  cost_optimizer: 'Cost Optimizer',
  risk_minimizer: 'Risk Minimizer',
  speed_maximizer: 'Speed Maximizer',
}

function ConsensusBadges({ option }) {
  const { persona_votes = {}, votes_for_this_option = 0, total_personas = 0 } = option.consensus || {}
  const optionIndex = (option.rank || 1) - 1
  return (
    <div
      style={{
        marginBottom: 12,
        padding: 10,
        borderRadius: 8,
        background: 'rgba(124,107,255,0.06)',
        border: '1px solid rgba(124,107,255,0.18)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--text-sec)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
          Agent Consensus
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: votes_for_this_option >= 2 ? 'var(--success)' : 'var(--text)',
          }}
        >
          {votes_for_this_option}/{total_personas} recommend
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {Object.entries(persona_votes).map(([persona, vote]) => {
          const recommends = vote === optionIndex
          return (
            <div
              key={persona}
              style={{
                fontSize: 10,
                color: recommends ? 'var(--success)' : 'var(--text-dim)',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>{PERSONA_LABEL[persona] || persona.replace(/_/g, ' ')}</span>
              <span>
                {recommends
                  ? '✓ recommends this'
                  : `→ option ${(vote || 0) + 1}`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OptionCard({ option, sim, isSelected, onSelect, simReady, eventId }) {
  const [showSim, setShowSim] = useState(true)
  const urgencyColor = URGENCY_COLOR[option.urgency_tier] || 'var(--warning)'
  const blocked = !!option.rejected_reason
  const leftBorderColor = isSelected ? 'var(--primary)' : option.rank === 1 ? 'var(--primary)' : option.rank === 2 ? 'var(--info)' : 'var(--text-dim)'

  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: `1px solid ${isSelected ? 'var(--primary)' : blocked ? 'var(--danger)44' : 'var(--glass-border)'}`,
        borderLeft: `3px solid ${leftBorderColor}`,
        padding: 14,
        opacity: blocked ? 0.5 : 1,
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 16, color: 'var(--text-dim)', minWidth: 30 }}>
          #{option.rank}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-pri)', marginBottom: 4 }}>
            {option.action_type}
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Tag color={urgencyColor}>{option.urgency_tier}</Tag>
            <Tag color="var(--success)">Effectiveness: {option.effectiveness_score}%</Tag>
            {option.cost_delta_pct > 0 && (
              <Tag color={option.cost_delta_pct > 15 ? 'var(--danger)' : 'var(--warning)'}>
                Cost Impact: +{option.cost_delta_pct}%
              </Tag>
            )}
            {option.time_impact && (
              <Tag color={RTO_TIER_COLOR[option.time_impact.rto_tier] || 'var(--info)'}>
                Recovery: {option.time_impact.rto_human}
              </Tag>
            )}
          </div>
        </div>
      </div>

      {option.time_impact && (
        <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 8 }}>
          Recovery time: {option.time_impact.rto_hours}h · {option.time_impact.basis}
        </div>
      )}

      {(option.supplier_name || option.quantity > 0) && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-sec)', marginBottom: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {option.supplier_name && <span>▸ {option.supplier_name}</span>}
          {option.quantity > 0 && <span>Quantity: {option.quantity}</span>}
        </div>
      )}

      <p className="mono" style={{ fontSize: 11, color: 'var(--text-sec)', lineHeight: 1.5, marginBottom: 12 }}>
        {option.rationale}
      </p>

      {option.consensus && option.consensus.total_personas > 0 && (
        <ConsensusBadges option={option} />
      )}

      {blocked && (
        <Tag color="var(--danger)" style={{ marginBottom: 10 }}>BLOCKED: {option.rejected_reason}</Tag>
      )}

      {sim && (
        <div style={{ marginBottom: 12 }}>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setShowSim(s => !s)}
            style={{ marginBottom: showSim ? 8 : 0 }}
          >
            {showSim ? '▾' : '▸'} Outcome Scenarios
            {sim.probability_valid === false && (
              <span style={{ color: 'var(--danger)', marginLeft: 6 }}>⚠ Σ≠100</span>
            )}
          </button>
          {showSim && (
            <div style={{ display: 'flex', gap: 8 }}>
              {sim.scenarios?.map(sc => <ScenarioCard key={sc.name} scenario={sc} />)}
            </div>
          )}
        </div>
      )}

      <button
        className={isSelected ? 'btn btn-primary' : 'btn'}
        onClick={() => !blocked && onSelect(option.rank)}
        disabled={!simReady || blocked}
        style={{ width: '100%' }}
      >
        {isSelected ? '✓ Selected' : blocked ? 'Blocked' : 'Select Option'}
      </button>

      {!blocked && eventId && <SupplierMessagePanel eventId={eventId} option={option} />}
    </div>
  )
}

export default function ActionOptions({ action, simulation, selectedOption, onSelect, eventId }) {
  if (!action?.options) return null
  const simReady = !!simulation
  const getSim = rank => simulation?.simulations?.find(s => s.option_rank === rank)

  return (
    <div className="panel">
      <PanelHeader
        label="Recommended Actions"
        accent="var(--primary)"
        right={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {simReady ? (
              <Tag color="var(--success)">
                ✓ Ready · {simulation.duration_seconds?.toFixed(1)}s
              </Tag>
            ) : (
              <Tag color="var(--warning)">⏳ Preparing scenarios...</Tag>
            )}
            <InfoTooltip {...ACTION_HELP} />
          </div>
        }
      />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {action.options.map(opt => (
          <OptionCard
            key={opt.rank}
            option={opt}
            sim={getSim(opt.rank)}
            isSelected={selectedOption === opt.rank}
            onSelect={onSelect}
            simReady={simReady}
            eventId={eventId}
          />
        ))}
      </div>
    </div>
  )
}
