import React from 'react'
import { PanelHeader, Tag, Stat, severityColor, InfoTooltip } from './ui.jsx'

const HELP = {
  event: {
    title: 'Event Overview',
    description: 'A summary of the current disruption event detected: where it is happening, what type (cyclone, strike, etc.), and how severe (1–10). Severity drives how aggressively the AI agents respond.',
  },
  memory: {
    title: 'What We\'ve Learned',
    description: 'Past disruptions similar to this one. The system uses prior outcomes to calibrate its current forecasts and risk scores — so estimates become more accurate over time.',
  },
  dissent: {
    title: 'Expert Disagreement Alert',
    description: 'When the Forecast, Risk, and Action agents disagree by more than 15 points on key metrics, this alert appears. Higher disagreement = more uncertainty in the AI recommendation, so a human must review before action.',
  },
  cascade: {
    title: 'Chain Reaction Alert',
    description: 'A second disruption hit within 48 hours and shares suppliers with the first. Combined severity is amplified 1.2×. Indicates the situation is escalating — you may need broader mitigation than a single-event response.',
  },
}

// ─── UI02: Event Summary Panel ──────────────────────────────────────────────
export function EventSummary({ monitor, cascade }) {
  if (!monitor) {
    return (
      <div className="panel panel-pad" style={{ minHeight: 140 }}>
        <PanelHeader label="Event Overview" accent="var(--text-dim)" right={<InfoTooltip {...HELP.event} />} />
        <div style={{ padding: 24, textAlign: 'center' }}>
          <p className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            [ no active event ]
          </p>
        </div>
      </div>
    )
  }
  const sev = monitor.severity_score
  const sevColor = severityColor(sev)
  return (
    <div
      className="panel slide-up"
      style={{ borderColor: sevColor + '44', borderLeft: `3px solid ${sevColor}` }}
    >
      <PanelHeader
        label="Event Overview"
        accent={sevColor}
        right={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Tag color="var(--text-dim)">{monitor.source}</Tag>
            <Tag color={sevColor}>{monitor.event_type}</Tag>
            <InfoTooltip {...HELP.event} />
          </div>
        }
      />
      <div style={{ padding: 18, display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 80 }}>
          <span className="eyebrow">Risk Level</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span className="digits digits-xl" style={{ color: sevColor }}>{sev}</span>
            <span className="mono" style={{ color: 'var(--text-dim)', fontSize: 12 }}>/10</span>
          </div>
          <div className="meter" style={{ width: 80, color: sevColor }}>
            <span style={{ width: `${sev * 10}%` }} />
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontFamily: 'var(--font-body)', fontSize: 17, fontStyle: 'italic', lineHeight: 1.25,
              color: 'var(--text-pri)', marginBottom: 8,
            }}
          >
            "{monitor.description}"
          </p>
          <p className="mono" style={{ fontSize: 11, color: 'var(--text-sec)', marginBottom: 10 }}>
            {monitor.severity_rationale}
          </p>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <span className="eyebrow">Geography</span>
              <p className="mono" style={{ fontSize: 12, color: 'var(--text-pri)', marginTop: 2 }}>{monitor.geography}</p>
            </div>
            <div>
              <span className="eyebrow">Event ID</span>
              <p className="mono" style={{ fontSize: 12, color: 'var(--primary)', marginTop: 2 }}>{monitor.event_id}</p>
            </div>
            <div>
              <span className="eyebrow">Detected</span>
              <p className="mono" style={{ fontSize: 12, color: 'var(--text-pri)', marginTop: 2 }}>
                {monitor.timestamp_utc?.split('T')[1]?.slice(0, 8)} UTC
              </p>
            </div>
            {cascade && (
              <Tag color="var(--pink)" style={{ alignSelf: 'flex-end' }}>⚡ Cascade Active</Tag>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── UI03: Memory Recall ────────────────────────────────────────────────────
export function MemoryRecall({ memories, onAck, acknowledged }) {
  if (!memories || memories.length === 0) return null
  const stage2 = memories.filter(m => m.stage === 2 || m.actual_outcome)
  if (stage2.length === 0) return null

  return (
    <div className="panel slide-up" style={{ borderColor: 'var(--info)44', borderLeft: '3px solid var(--info)' }}>
      <PanelHeader
        label="What We've Learned"
        accent="var(--info)"
        right={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Tag color="var(--info)">{stage2.length} similar disruption{stage2.length === 1 ? '' : 's'}</Tag>
            <InfoTooltip {...HELP.memory} />
          </div>
        }
      />
      <div style={{ padding: 14 }}>
        <p className="mono" style={{ fontSize: 11, color: 'var(--text-sec)', marginBottom: 12 }}>
          → We found similar disruptions before. Past outcomes help us adjust current risk and demand estimates.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {stage2.map((m, i) => (
            <div
              key={i}
              style={{
                background: 'var(--bg-deep)', border: '1px solid var(--glass-border)',
                padding: 10, fontSize: 11,
              }}
            >
              <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Tag color="var(--info)">{m.memory_id}</Tag>
                <span className="mono" style={{ color: 'var(--text-sec)' }}>{m.event_type}</span>
                <span className="mono" style={{ color: 'var(--text-dim)' }}>·</span>
                <span className="mono" style={{ color: 'var(--text-sec)' }}>{m.geography}</span>
                {m.resolution_date && (
                  <span className="mono" style={{ color: 'var(--text-dim)', marginLeft: 'auto' }}>
                    {m.resolution_date}
                  </span>
                )}
              </div>
              <p style={{ color: 'var(--text-pri)', fontSize: 12, marginBottom: 4 }}>
                <span className="label" style={{ color: 'var(--text-dim)' }}>What happened —</span>{' '}
                <span className="mono">{m.actual_outcome}</span>
              </p>
              {m.predicted_demand_shift != null && m.actual_demand_shift != null && (
                <p className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  predicted {m.predicted_demand_shift}% → actual {m.actual_demand_shift}%
                </p>
              )}
              {m.learning_signal && (
                <p className="mono" style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4 }}>
                  ⓘ {m.learning_signal}
                </p>
              )}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          {acknowledged ? (
            <Tag color="var(--success)">✓ Reviewed</Tag>
          ) : (
            <button className="btn btn-ghost" onClick={onAck}>
              Review These Lessons
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── UI04: Agent Dissent Panel ──────────────────────────────────────────────
export function DissentPanel({ divergence, onAck, acknowledged }) {
  if (!divergence?.dissent_detected) return null
  return (
    <div
      className="panel slide-up"
      style={{ borderColor: 'var(--purple)', borderLeft: '3px solid var(--purple)' }}
    >
      <PanelHeader
        label="Expert Disagreement Alert"
        accent="var(--purple)"
        right={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="eyebrow">Level</span>
            <span className="digits digits-md" style={{ color: 'var(--purple)' }}>
              {divergence.divergence_score}
            </span>
            <span className="mono" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
              / {divergence.threshold}
            </span>
            <InfoTooltip {...HELP.dissent} />
          </div>
        }
      />
      <div style={{ padding: 16 }}>
        <p className="mono" style={{ fontSize: 11, color: 'var(--text-sec)', marginBottom: 14, lineHeight: 1.6 }}>
          {divergence.dissent_description}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'stretch' }}>
          <div
            style={{
              background: 'var(--bg-deep)', border: '1px solid var(--info)44',
              borderLeft: '2px solid var(--info)', padding: 12,
            }}
          >
            <span className="eyebrow" style={{ color: 'var(--info)' }}>Demand Forecast</span>
            <p className="digits digits-lg c-pri" style={{ marginTop: 6 }}>
              {divergence.forecast_severity_normalised}
              <span className="mono" style={{ color: 'var(--text-dim)', fontSize: 11, fontWeight: 400 }}> /100</span>
            </p>
            <p className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
              demand impact
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div className="mono" style={{ color: 'var(--purple)', fontSize: 16, fontWeight: 700, transform: 'rotate(0deg)' }}>
              ⇄
            </div>
            <span className="eyebrow" style={{ color: 'var(--purple)', fontSize: 9, marginTop: 4 }}>differ</span>
          </div>

          <div
            style={{
              background: 'var(--bg-deep)', border: '1px solid rgba(244,114,182,0.2)',
              borderRight: '2px solid var(--pink)', padding: 12, textAlign: 'right',
            }}
          >
            <span className="eyebrow" style={{ color: 'var(--pink)' }}>Supplier Risk</span>
            <p className="digits digits-lg c-pri" style={{ marginTop: 6 }}>
              {divergence.avg_supplier_risk}
              <span className="mono" style={{ color: 'var(--text-dim)', fontSize: 11, fontWeight: 400 }}> /100</span>
            </p>
            <p className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
              top suppliers risk
            </p>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          {acknowledged ? (
            <Tag color="var(--success)">✓ Acknowledged</Tag>
          ) : (
            <button className="btn" style={{ borderColor: 'var(--purple)', color: 'var(--purple)' }} onClick={onAck}>
              I Understand
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── UI05: Cascade Risk Alert ───────────────────────────────────────────────
export function CascadeAlert({ cascade, onAck, acknowledged }) {
  if (!cascade) return null
  return (
    <div
      className="panel slide-up"
      style={{ borderColor: 'var(--pink)', borderLeft: `3px solid var(--pink)` }}
    >
      <PanelHeader
        label="⚡ Chain Reaction Alert"
        accent="var(--pink)"
        right={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="eyebrow">Combined Risk</span>
            <span className="digits digits-md" style={{ color: 'var(--pink)' }}>
              {cascade.combined_severity_score}
            </span>
            <InfoTooltip {...HELP.cascade} />
          </div>
        }
      />
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 24, marginBottom: 12, flexWrap: 'wrap' }}>
          <Stat label="Type of Reaction" value={cascade.cascade_type} color="var(--pink)" size="md" />
          <Stat label="Affected Region" value={cascade.overlap_zone} color="var(--text-pri)" size="md" />
          <Stat
            label="Risk Multiplier"
            value={`×${cascade.overlap_multiplier}`}
            color="var(--text-sec)"
            size="md"
          />
        </div>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, fontStyle: 'italic', color: 'var(--text-pri)', marginBottom: 12, lineHeight: 1.4 }}>
          {cascade.summary}
        </p>
        {cascade.shared_suppliers?.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <span className="eyebrow">Suppliers at Risk</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {cascade.shared_suppliers.map((s, i) => (
                <Tag key={i} color="var(--pink)">{s}</Tag>
              ))}
            </div>
          </div>
        )}
        <div>
          {acknowledged ? (
            <Tag color="var(--success)">✓ Acknowledged</Tag>
          ) : (
            <button className="btn" style={{ borderColor: 'var(--pink)', color: 'var(--pink)' }} onClick={onAck}>
              Acknowledge Chain Reaction Risk
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
