import React from 'react'
import { InfoTooltip } from './ui'

/**
 * MemoryLedgerPanel — visualises the MCF (Memory-Calibrated Forecast) loop
 * for one event. Hidden when no Stage-2 records were used.
 *
 * Reads directly from the forecast slice of a swarm event:
 *   forecast.mcf_sample_size       — int, how many past events were used
 *   forecast.mcf_adjustment        — float, percentage points applied
 *   forecast.mcf_confidence_boost  — float, confidence boost added
 *   forecast.affected_categories[0].demand_shift_pct — calibrated final shift
 *
 * The "unadjusted" forecast is reconstructed as ``calibrated - adjustment``
 * so the user can see the raw → calibrated → final flow.
 */
export default function MemoryLedgerPanel({ forecast }) {
  if (!forecast) return null
  const sample = Number(forecast.mcf_sample_size) || 0
  // Section 5 Sprint: also render this panel when own-Stage-2 is empty but
  // a federated baseline was used to bootstrap the cold-start forecast.
  const federated = forecast.baseline_source === 'federated' ? forecast.federated_baseline : null
  if (sample === 0 && !federated) return null

  const adjustment = Number(forecast.mcf_adjustment) || 0
  const confidenceBoost = Number(forecast.mcf_confidence_boost) || 0
  const calibrated = Number(
    (forecast.affected_categories && forecast.affected_categories[0]?.demand_shift_pct) || 0
  )
  const unadjusted = +(calibrated - adjustment).toFixed(1)
  const adjustmentColor = adjustment > 0 ? '#10B981' : adjustment < 0 ? '#F59E0B' : 'var(--text-sec)'

  return (
    <div
      className="panel memory-ledger-panel"
      style={{
        padding: 16,
        borderRadius: 12,
        background: 'rgba(124,107,255,0.05)',
        border: '1px solid rgba(124,107,255,0.25)',
        marginTop: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>
          Memory-Calibrated Forecast (MCF)
        </span>
        <InfoTooltip
          title="How the AI learns"
          description={
            'Past disruptions inform current forecasts. MCF adjusts the prediction '
            + 'based on historical events that match this event type and geography. '
            + 'When you have no own history yet, an anonymised federated baseline from '
            + 'other clients can be blended in to cold-start the calibration.'
          }
        />
        {federated && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: '#7c6bff',
              background: 'rgba(124,107,255,0.12)',
              border: '1px solid rgba(124,107,255,0.35)',
              padding: '3px 9px',
              borderRadius: 10,
            }}
            title="Anonymised aggregate of similar events across other clients on the platform"
          >
            Federated
          </span>
        )}
      </div>
      {federated && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(124,107,255,0.08)',
            border: '1px solid rgba(124,107,255,0.25)',
            fontSize: 12,
            color: 'var(--text-sec)',
            lineHeight: 1.5,
            marginBottom: 10,
          }}
        >
          Calibrated from federated baseline of <strong style={{ color: 'var(--text-pri)' }}>{federated.sample_size}</strong>{' '}
          similar event{federated.sample_size === 1 ? '' : 's'} across{' '}
          <strong style={{ color: 'var(--text-pri)' }}>{federated.contributing_clients}</strong>{' '}
          client{federated.contributing_clients === 1 ? '' : 's'} (confidence: {federated.confidence}). Data is anonymised — no individual client's records are exposed.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Row label="Raw forecast (no memory)" value={`${unadjusted.toFixed(1)}%`} subtle />
        <Arrow />
        <Row
          label={`MCF adjustment from ${sample} historical event${sample === 1 ? '' : 's'}`}
          value={`${adjustment > 0 ? '+' : ''}${adjustment.toFixed(1)}%`}
          valueColor={adjustmentColor}
          sub={`Confidence boost +${confidenceBoost.toFixed(1)} pts`}
          highlight
        />
        <Arrow />
        <Row label="Calibrated forecast" value={`${calibrated.toFixed(1)}%`} strong />
      </div>
    </div>
  )
}

function Row({ label, value, sub, subtle, strong, highlight, valueColor }) {
  const bg = highlight
    ? 'rgba(245,158,11,0.10)'
    : strong
    ? 'rgba(16,185,129,0.10)'
    : 'rgba(255,255,255,0.03)'
  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        background: bg,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 11, color: subtle ? 'var(--text-sec)' : 'var(--text)', fontWeight: subtle ? 500 : 600 }}>
          {label}
        </span>
        {sub && <span style={{ fontSize: 10, color: 'var(--text-sec)' }}>{sub}</span>}
      </div>
      <div
        style={{
          fontSize: strong ? 18 : 14,
          fontWeight: 700,
          color: valueColor || 'var(--text)',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function Arrow() {
  return (
    <div style={{ textAlign: 'center', color: 'var(--text-sec)', fontSize: 14, lineHeight: 1 }}>↓</div>
  )
}
