import React, { useEffect, useState } from 'react'
import { api } from '../services/api.js'
import { InfoTooltip } from './ui.jsx'

/**
 * BenchmarkStrip - Section 8 of the Market Differentiation Sprint.
 *
 * UNIQUE FEATURE - competitor platforms don't offer cross-industry
 * benchmarking out of the box. Shows the client's metrics side-by-side
 * with their industry's baseline (computed from 10 curated dataset files).
 *
 * Renders nothing when the comparison is unavailable (unknown industry or
 * the client hasn't been classified yet). Empty supplier state still
 * shows the industry bar so the user can see "what good looks like".
 */

const METRIC_DEFS = [
  { key: 'avg_reliability',       label: 'Reliability %',          unit: '%' },
  { key: 'avg_buffer_days',       label: 'Buffer Days',            unit: 'd' },
  { key: 'avg_sites',             label: 'Sites/Supplier',         unit: '' },
  { key: 'single_source_rate',    label: 'Single-Source %',        unit: '%' },
  { key: 'geo_concentration_pct', label: 'Top-Zone Concentration', unit: '%' },
]

const VERDICT_STYLE = {
  better:  { color: '#22c55e', label: 'Better' },
  in_line: { color: '#94a3b8', label: 'In line' },
  worse:   { color: '#f97316', label: 'Below' },
}

function MetricBlock({ def, data }) {
  if (!data) return null
  const v = VERDICT_STYLE[data.verdict] || VERDICT_STYLE.in_line
  return (
    <div style={{
      flex: '1 1 160px',
      minWidth: 160,
      padding: '12px 14px',
      borderRadius: 10,
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${v.color}40`,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {def.label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-pri)' }}>
          {data.client}<span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{def.unit}</span>
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          vs industry <strong style={{ color: 'var(--text-sec)' }}>{data.industry}{def.unit}</strong>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: v.color, textTransform: 'uppercase' }}>
          {v.label}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {data.delta > 0 ? '+' : ''}{data.delta}{def.unit}
        </span>
      </div>
    </div>
  )
}

export default function BenchmarkStrip() {
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    api.industryBenchmark()
      .then(res => { if (alive) setPayload(res) })
      .catch(err => { if (alive) setError(err?.message || 'Failed to load benchmark') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  if (loading) {
    return (
      <div className="panel panel-pad">
        <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>Loading industry benchmark…</div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="panel panel-pad">
        <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>
      </div>
    )
  }
  if (!payload) return null

  const comparison = payload.comparison

  return (
    <div className="panel panel-pad">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 16 }}>📊</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-pri)' }}>
          You vs Industry {payload.industry ? `(${payload.industry})` : ''}
        </span>
        <InfoTooltip
          title="Cross-industry benchmark"
          description={
            'Your portfolio metrics compared to the industry baseline computed from 10 curated reference '
            + 'datasets. Green = better than peers; orange = below average. Unique to DisruptIQ.'
          }
        />
        {comparison && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)' }}>
            Industry baseline: <strong style={{ color: 'var(--text-pri)' }}>{comparison.baseline_supplier_count}</strong> suppliers
          </span>
        )}
      </div>

      {!comparison ? (
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(124,107,255,0.07)', border: '1px solid rgba(124,107,255,0.2)', color: 'var(--text-sec)', fontSize: 13, lineHeight: 1.55 }}>
          {payload.message || 'Set your company industry to see how you compare to peers.'}
          {payload.available_industries?.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>
              Supported industries: {payload.available_industries.join(', ')}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {METRIC_DEFS.map(def => (
            <MetricBlock key={def.key} def={def} data={comparison.metrics?.[def.key]} />
          ))}
        </div>
      )}
    </div>
  )
}
