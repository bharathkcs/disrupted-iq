import React, { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ErrorBar } from 'recharts'
import { PanelHeader, Tag, tierColor, InfoTooltip } from './ui.jsx'

const RISK_HELP = {
  title: 'Supplier Risk Analysis',
  description: 'Each supplier is scored 0–100 across 5 factors: geographic proximity to the disruption, buffer stock, site concentration, reliability history, and category exposure. Tiers: Critical (>75), High (60-75), Medium (40-60), Low (<40). The "Past Experience" column shows score adjustments learned from prior similar events.',
}

const FORECAST_HELP = {
  title: 'Demand Impact Forecast',
  description: 'XGBoost-based projection of demand changes per category, in percent shift from baseline. The error bars show the confidence interval (low–high range). When low confidence, bars turn amber — interpret with caution. Forecasts are calibrated against past actual outcomes via the memory system.',
}

// ─── Feature 5: "What Changed?" risk explanation modal ──────────────────────

const STATUS_COLOR = {
  critical: 'var(--danger)',
  warning:  'var(--warning)',
  ok:       'var(--success)',
}
const STATUS_LABEL = { critical: 'High Risk', warning: 'Elevated', ok: 'Healthy' }
const STATUS_BG    = {
  critical: 'rgba(239,68,68,0.10)',
  warning:  'rgba(245,158,11,0.10)',
  ok:       'rgba(34,197,94,0.08)',
}

function NewsAlertBadge({ alerts = [], count = 0 }) {
  const [open, setOpen] = React.useState(false)
  if (!count) return null
  return (
    <span
      style={{ position: 'relative', marginLeft: 6 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          padding: '1px 6px',
          fontSize: 9,
          fontWeight: 700,
          color: 'var(--warning)',
          background: 'rgba(245,158,11,0.12)',
          border: '1px solid rgba(245,158,11,0.35)',
          borderRadius: 4,
          cursor: 'help',
          verticalAlign: 'middle',
        }}
        aria-label={`${count} recent news alert${count === 1 ? '' : 's'}`}
      >
        ⚠ {count}
      </span>
      {open && alerts.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 18,
            left: 0,
            zIndex: 600,
            width: 320,
            padding: 10,
            background: 'rgba(6,9,24,0.98)',
            border: '1px solid var(--glass-border-bright)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            textAlign: 'left',
          }}
        >
          <div style={{ fontSize: 10, color: 'var(--warning)', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Recent news pulse
          </div>
          {alerts.slice(0, 3).map((a, i) => (
            <div key={i} style={{ marginBottom: 8, paddingBottom: 6, borderBottom: i < alerts.length - 1 ? '1px dashed var(--glass-border)' : 'none' }}>
              <div style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600, lineHeight: 1.3 }}>
                {a.headline}
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-sec)', marginTop: 2 }}>
                {a.source}
                {a.url && (
                  <>
                    {' · '}
                    <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>view</a>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </span>
  )
}

function RiskGauge({ score, tier }) {
  const r = 44
  const circ = 2 * Math.PI * r
  const filled = circ * (score / 100)
  const color = tier === 'Critical' ? 'var(--danger)'
              : tier === 'High'     ? 'var(--warning)'
              : tier === 'Medium'   ? 'var(--info)'
              :                      'var(--success)'
  return (
    <div style={{ position: 'relative', width: 110, height: 110, flexShrink: 0 }}>
      <svg width="110" height="110" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="55" cy="55" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" />
        <circle cx="55" cy="55" r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={`${filled} ${circ - filled}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 26, fontWeight: 800, color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
          {score}
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: 1, marginTop: 2 }}>/ 100</span>
      </div>
    </div>
  )
}

function FactorCard({ fkey, detail, isTop }) {
  if (!detail) return null
  const { label, icon, raw, weighted, status, interpretation } = detail
  const sc = STATUS_COLOR[status] || 'var(--text-dim)'
  const bg = STATUS_BG[status]  || 'rgba(255,255,255,0.03)'
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      background: isTop ? 'rgba(239,68,68,0.07)' : bg,
      border: `1px solid ${isTop ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.07)'}`,
      marginBottom: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 15 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-pri)', flex: 1 }}>
          {label}
          {isTop && (
            <span style={{ marginLeft: 6, fontSize: 9, background: 'rgba(239,68,68,0.25)',
              color: 'var(--danger)', borderRadius: 3, padding: '1px 5px', fontWeight: 700 }}>
              TOP DRIVER
            </span>
          )}
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, color: sc,
          background: bg, padding: '2px 7px', borderRadius: 4 }}>
          {STATUS_LABEL[status] || status}
        </span>
      </div>
      <div style={{ height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 3,
        overflow: 'hidden', marginBottom: 6 }}>
        <div style={{ height: '100%', width: `${Math.min(100, raw)}%`, borderRadius: 3,
          background: sc, transition: 'width 0.5s ease' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>raw exposure: {raw}</span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          weighted: <span className="mono" style={{ color: sc }}>{weighted} pts</span>
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-sec)', lineHeight: 1.55 }}>{interpretation}</p>
    </div>
  )
}

function RiskChangeModal({ detail, onClose }) {
  if (!detail) return null

  const tier2color = detail.risk_tier === 'Critical' ? 'var(--danger)'
                   : detail.risk_tier === 'High'     ? 'var(--warning)'
                   : detail.risk_tier === 'Medium'   ? 'var(--info)'
                   :                                   'var(--success)'
  const tier2status = detail.risk_tier === 'Critical' ? 'critical'
                    : detail.risk_tier === 'High'     ? 'warning'
                    :                                   'ok'

  const FACTOR_ORDER = ['proximity', 'buffer_score', 'site_score', 'reliability_score', 'category_score']
  const fdetails = detail.factor_details || {}

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} className="panel"
        style={{ maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--glass-border)',
          display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 2, letterSpacing: 1 }}>RISK ANALYSIS</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-pri)' }}>{detail.supplier_name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
              {detail.supplier_id}
            </div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} style={{ alignSelf: 'flex-start' }}>✕</button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Score hero row */}
          <div style={{
            display: 'flex', gap: 16, alignItems: 'center',
            padding: '14px 16px', borderRadius: 10,
            background: 'linear-gradient(135deg, rgba(239,68,68,0.06), rgba(0,0,0,0.2))',
            border: '1px solid rgba(239,68,68,0.15)',
          }}>
            <RiskGauge score={detail.composite_score} tier={detail.risk_tier} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{
                  fontSize: 13, fontWeight: 700, color: tier2color,
                  background: STATUS_BG[tier2status], padding: '3px 10px', borderRadius: 5,
                }}>
                  {detail.risk_tier} Risk
                </span>
                {detail.memory_adjustment > 0 && (
                  <span style={{
                    fontSize: 11, color: 'var(--warning)',
                    background: 'rgba(245,158,11,0.12)', padding: '3px 8px', borderRadius: 5,
                  }}>
                    +{detail.memory_adjustment} pts from memory
                  </span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                {[
                  ['Base Score', detail.base_score],
                  ['Buffer Stock', `${detail.buffer_stock_days}d`],
                  ['Reliability', `${detail.reliability}%`],
                  ['Sites', detail.sites],
                ].map(([lbl, val]) => (
                  <div key={lbl} style={{ fontSize: 11 }}>
                    <span style={{ color: 'var(--text-dim)' }}>{lbl}: </span>
                    <span style={{ color: 'var(--text-pri)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{val}</span>
                  </div>
                ))}
              </div>
              {detail.categories?.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {detail.categories.map(c => (
                    <span key={c} style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 4,
                      background: 'rgba(99,102,241,0.15)', color: 'var(--primary)',
                    }}>{c}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* LLM narrative */}
          {detail.llm_narrative && (
            <div style={{
              padding: '12px 14px', borderRadius: 8,
              background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)',
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: 'var(--primary)',
                letterSpacing: 1, marginBottom: 6,
              }}>✦ AI RISK ASSESSMENT</div>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-pri)', lineHeight: 1.7 }}>
                {detail.llm_narrative}
              </p>
            </div>
          )}

          {/* Factor breakdown */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Risk Factor Breakdown</div>
            {FACTOR_ORDER.map(k => (
              <FactorCard key={k} fkey={k} detail={fdetails[k]} isTop={k === detail.top_factor} />
            ))}
          </div>

          {/* Primary drivers */}
          {detail.primary_drivers?.length > 0 && (
            <div style={{
              padding: '10px 14px', borderRadius: 8,
              background: 'rgba(255,255,255,0.02)', border: '1px solid var(--glass-border)',
            }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Why This Score</div>
              {detail.primary_drivers.map((d, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--danger)', fontSize: 13, lineHeight: 1, flexShrink: 0 }}>▸</span>
                  <span style={{ fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.55 }}>{d}</span>
                </div>
              ))}
            </div>
          )}

          {/* Memory adjustment */}
          {detail.memory_explanation && (
            <div style={{
              padding: '10px 14px', borderRadius: 8,
              background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)',
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: 'var(--warning)',
                letterSpacing: 1, marginBottom: 6,
              }}>🧠 LEARNED FROM PAST EVENTS</div>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.6 }}>
                {detail.memory_explanation}
              </p>
            </div>
          )}

          {/* Recommended action */}
          {detail.recommended_action && (
            <div style={{
              padding: '12px 14px', borderRadius: 8,
              background: detail.risk_tier === 'Critical' ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${detail.risk_tier === 'Critical' ? 'rgba(239,68,68,0.3)' : 'var(--glass-border)'}`,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 6,
                color: detail.risk_tier === 'Critical' ? 'var(--danger)' : 'var(--text-dim)',
              }}>
                {detail.risk_tier === 'Critical' ? '🚨' : detail.risk_tier === 'High' ? '⚠️' : 'ℹ️'} RECOMMENDED ACTION
              </div>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-pri)', lineHeight: 1.6 }}>
                {detail.recommended_action}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── UI06: Supplier Risk Table ──────────────────────────────────────────────
export function SupplierRiskTable({ riskData }) {
  const [sort, setSort] = useState('composite_score')
  const [detail, setDetail] = useState(null)
  if (!riskData?.suppliers) return null
  const sorted = [...riskData.suppliers].sort((a, b) => b[sort] - a[sort])

  return (
    <>
    <div className="panel">
      <PanelHeader
        label="Supplier Risk Analysis"
        accent="var(--danger)"
        right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[
              ['composite_score', 'risk'],
              ['buffer_stock_days', 'buffer'],
              ['reliability', 'reliability'],
            ].map(([f, label]) => (
              <button
                key={f}
                onClick={() => setSort(f)}
                className="btn btn-sm"
                style={{
                  borderColor: sort === f ? 'var(--primary)' : 'var(--glass-border-bright)',
                  color: sort === f ? 'var(--primary)' : 'var(--text-sec)',
                }}
              >
                {label}
              </button>
            ))}
            <InfoTooltip {...RISK_HELP} />
          </div>
        }
      />
      <div style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Zone</th>
              <th>Risk Score</th>
              <th>Tier</th>
              <th>Buffer</th>
              <th>Reliability</th>
              <th>Sites</th>
              <th>Past Experience</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(s => (
              <tr key={s.supplier_id} style={{ background: s.is_critical ? 'rgba(248,113,113,0.08)' : 'transparent' }}>
                <td style={{ color: s.is_critical ? 'var(--danger)' : 'var(--text-pri)', fontWeight: s.is_critical ? 600 : 400 }}>
                  {s.is_critical && <span style={{ color: 'var(--danger)', marginRight: 6 }}>●</span>}
                  {s.supplier_name}
                  {s.in_event_zone === false && (
                    <span style={{
                      marginLeft: 6, fontSize: 8, padding: '1px 5px', borderRadius: 3,
                      background: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.18)',
                      color: 'var(--text-dim)', fontWeight: 700, letterSpacing: '0.04em',
                      verticalAlign: 'middle',
                    }}>INDIRECT</span>
                  )}
                  {s.news_alert_count > 0 && <NewsAlertBadge alerts={s.news_alerts} count={s.news_alert_count} />}
                  <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 1 }}>
                    {s.supplier_id}
                  </div>
                </td>
                <td className="c-sec">{s.zone}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="digits" style={{ color: tierColor(s.risk_tier), fontSize: 13 }}>
                      {s.composite_score}
                    </span>
                    <div className="meter" style={{ color: tierColor(s.risk_tier), width: 50 }}>
                      <span style={{ width: `${s.composite_score}%` }} />
                    </div>
                  </div>
                </td>
                <td><Tag color={tierColor(s.risk_tier)}>{s.risk_tier}</Tag></td>
                <td style={{
                  color: s.buffer_stock_days <= 3 ? 'var(--danger)'
                       : s.buffer_stock_days <= 7 ? 'var(--warning)'
                       : 'var(--text-sec)',
                  fontWeight: s.buffer_stock_days <= 7 ? 600 : 400,
                }}>
                  {s.buffer_stock_days}d
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)',
                      color: s.reliability < 75 ? 'var(--danger)'
                           : s.reliability < 85 ? 'var(--warning)'
                           : 'var(--success)',
                    }}>
                      {s.reliability}%
                    </span>
                    <div style={{ width: 34, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 2, width: `${s.reliability}%`,
                        background: s.reliability < 75 ? 'var(--danger)'
                                  : s.reliability < 85 ? 'var(--warning)'
                                  : 'var(--success)',
                      }} />
                    </div>
                  </div>
                </td>
                <td className="c-sec">{s.sites}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ flex: 1 }}>
                      {s.memory_adjustment > 0 ? (
                        <span className="mono" style={{ color: 'var(--warning)', fontSize: 10 }}>
                          +{s.memory_adjustment} pts
                          {s.memory_source_event && (
                            <span style={{ color: 'var(--text-dim)', marginLeft: 4 }}>
                              ({s.memory_source_event.slice(-6)})
                            </span>
                          )}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-dim)' }}>—</span>
                      )}
                    </div>
                    {s.memory_confidence && (
                      <span style={{
                        marginLeft: 4, fontSize: 9, padding: '1px 5px', borderRadius: 4,
                        background: s.memory_confidence === 'high' ? 'rgba(45,212,191,0.15)' : s.memory_confidence === 'medium' ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)',
                        color: s.memory_confidence === 'high' ? 'var(--success)' : s.memory_confidence === 'medium' ? 'var(--warning)' : 'var(--text-dim)',
                      }}>
                        {s.memory_confidence === 'high' ? 'H' : s.memory_confidence === 'medium' ? 'M' : 'L'}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  {s.change_explanation ? (
                    <button
                      onClick={() => setDetail(s.change_explanation)}
                      style={{
                        padding: '4px 10px', fontSize: 11, fontWeight: 600,
                        background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)',
                        borderRadius: 5, color: 'var(--primary)', cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                    >
                      Why? ✦
                    </button>
                  ) : (
                    <span style={{ color: 'var(--text-dim)' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {riskData.content_safety_passed != null && (
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--glass-border)', display: 'flex', gap: 10 }}>
          <Tag color={riskData.content_safety_passed ? 'var(--success)' : 'var(--danger)'}>
            {riskData.content_safety_passed ? '✓ Recommendation Safe' : '❌ Recommendation Blocked'}
          </Tag>
          {riskData.content_safety_demo_mode && <Tag color="var(--text-dim)">demo</Tag>}
        </div>
      )}
    </div>
    <RiskChangeModal detail={detail} onClose={() => setDetail(null)} />
    </>
  )
}

// ─── UI07: Demand Impact Chart ──────────────────────────────────────────────
export function DemandChart({ forecast }) {
  if (!forecast?.affected_categories) return null
  const data = forecast.affected_categories.map(c => ({
    category: c.category,
    baseline: 100,
    disrupted: 100 + (c.demand_shift_pct || 0),
    shift: c.demand_shift_pct || 0,
    confidence: c.confidence,
    low_confidence: c.low_confidence,
    errorBar: c.confidence_interval ? [
      c.confidence_interval.low ?? 0,
      c.confidence_interval.high ?? 0,
    ] : [0, 0],
  }))

  return (
    <div className="panel">
      <PanelHeader
        label="Demand Impact Forecast"
        accent="var(--info)"
        right={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {forecast.memory_calibration_applied && (
              <Tag color="var(--info)">✱ adjusted from past</Tag>
            )}
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              {forecast.model_version}
            </span>
            <InfoTooltip {...FORECAST_HELP} />
          </div>
        }
      />
      <div style={{ padding: 16 }}>
        {forecast.narrative && (
          <p style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: 14, color: 'var(--text-sec)', marginBottom: 14, lineHeight: 1.45 }}>
            {forecast.narrative}
          </p>
        )}
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} barGap={6}>
            <XAxis
              dataKey="category"
              tick={{ fill: 'var(--text-dim)', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={{ stroke: 'var(--glass-border)' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'var(--text-dim)', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
              domain={[80, 'auto']}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--bg-deep)',
                border: '1px solid var(--glass-border-bright)',
                borderRadius: 0,
                fontSize: 11,
                fontFamily: 'JetBrains Mono',
              }}
              formatter={(v, n) => [n === 'baseline' ? '100 base' : `${v} (Δ ${(v - 100).toFixed(1)}%)`, n]}
            />
            <Bar dataKey="baseline" fill="var(--text-dim)" />
            <Bar dataKey="disrupted">
              {data.map((d, i) => (
                <Cell key={i} fill={d.low_confidence ? 'var(--warning)' : 'var(--info)'} />
              ))}
              <ErrorBar dataKey="errorBar" width={4} strokeWidth={2} stroke="var(--warning)" direction="y" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          {data.map(d => (
            <div key={d.category} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                className="dot"
                style={{ color: d.low_confidence ? 'var(--warning)' : 'var(--info)' }}
              />
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-pri)' }}>
                {d.category} <span style={{ color: 'var(--primary)' }}>+{d.shift.toFixed(1)}%</span>
              </span>
              {d.low_confidence && (
                <span className="mono" style={{ fontSize: 9, color: 'var(--warning)' }}>
                  ⚠ low-conf
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
