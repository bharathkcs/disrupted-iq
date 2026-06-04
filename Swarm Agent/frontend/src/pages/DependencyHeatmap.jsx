import React, { useEffect, useState } from 'react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../services/api.js'
import { PanelHeader, Tag, InfoTooltip } from '../components/ui.jsx'
import InsightsPanel from '../components/InsightsPanel.jsx'

const RISK_COLOR = {
  critical: 'var(--danger)',
  high: '#FB923C',
  moderate: 'var(--warning)',
  low: 'var(--success)',
}

const RISK_PLAIN = {
  critical: 'Single-source — any disruption stops your supply completely.',
  high: 'Most of this category comes from one zone. A regional event could have a big impact.',
  moderate: 'Some concentration present. Diversifying further would reduce risk.',
  low: 'Well spread across zones. Lower exposure to single-point disruptions.',
}

function StatCard({ label, value, color, sub }) {
  return (
    <div className="panel panel-pad" style={{ flex: 1, minWidth: 150 }}>
      <div className="eyebrow">{label}</div>
      <div className="digits digits-lg" style={{ color: color || 'var(--text-pri)', marginTop: 6 }}>{value}</div>
      {sub && <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export default function DependencyHeatmap() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [selectedCell, setSelectedCell] = useState(null)

  const [isRefreshing, setIsRefreshing] = useState(false)

  const loadData = async () => {
    try {
      setIsRefreshing(true)
      const d = await api.dependencyHeatmap()
      setData(d)
    } catch (err) {
      setError(String(err))
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    let alive = true
    loadData()
    // Auto-refresh every 5 seconds for real-time updates
    const t = setInterval(() => { if (alive) loadData() }, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  if (error) return (
    <div style={{ maxWidth: 1700, margin: '0 auto', padding: 16 }}>
      <div className="panel panel-pad" style={{ color: 'var(--danger)' }}>Failed to load dependency data: {error}</div>
    </div>
  )
  if (!data) return (
    <div style={{ maxWidth: 1700, margin: '0 auto', padding: 16 }}>
      <div className="panel panel-pad"><span className="mono c-dim">Analysing supplier dependencies...</span></div>
    </div>
  )

  const { categories, zones, cells, concentration_risks, single_source_categories, summary } = data
  const cellMap = {}
  cells.forEach(c => { cellMap[`${c.category}|${c.zone}`] = c })
  const maxScore = data.max_dependency_score || 1
  const chartData = concentration_risks.map(r => ({ category: r.category, share: r.share_pct, risk: r.risk_level }))
  const criticalCount = concentration_risks.filter(r => r.risk_level === 'critical').length
  const highCount = concentration_risks.filter(r => r.risk_level === 'high').length

  const cellDetail = selectedCell ? cellMap[selectedCell] : null
  const cellCategory = selectedCell?.split('|')[0]
  const cellZone = selectedCell?.split('|')[1]

  // Show empty state if no suppliers
  if (summary.total_suppliers === 0) {
    return (
      <div style={{ maxWidth: 1700, margin: '0 auto', width: '100%', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="panel panel-pad">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-pri)', marginBottom: 6 }}>Supplier Dependency Analysis</div>
              <div style={{ fontSize: 13, color: 'var(--text-sec)', maxWidth: 660, lineHeight: 1.65 }}>
                This shows how diversified your supply chain is across different product categories and geographic zones.
              </div>
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-dim)' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔗</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: 'var(--text-sec)' }}>No suppliers uploaded yet</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Upload suppliers to see your dependency analysis and concentration risks</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1700, margin: '0 auto', width: '100%', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Page header */}
      <div className="panel panel-pad">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-pri)', marginBottom: 6 }}>Supplier Dependency Analysis</div>
            <div style={{ fontSize: 13, color: 'var(--text-sec)', maxWidth: 660, lineHeight: 1.65 }}>
              This shows how diversified your supply chain is across different product categories and geographic zones.
              Heavy reliance on a single supplier or region is a hidden risk — a strike, flood, or insolvency in one
              place can halt your entire supply. Use this page to identify and fix those weak points before a disruption hits.
            </div>
          </div>
          {(criticalCount > 0 || highCount > 0) && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, minWidth: 220,
              background: criticalCount > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.08)',
              border: `1px solid ${criticalCount > 0 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.25)'}`,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: criticalCount > 0 ? 'var(--danger)' : 'var(--warning)', marginBottom: 4 }}>
                {criticalCount > 0 ? `⚠ ${criticalCount} critical risk${criticalCount > 1 ? 's' : ''}` : `${highCount} high-risk areas`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.5 }}>
                {criticalCount > 0 ? 'These categories need backup suppliers immediately.' : 'Consider diversifying high-concentration categories.'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Guide */}
      <div className="panel panel-pad" style={{ background: 'rgba(124,107,255,0.05)', border: '1px solid rgba(124,107,255,0.2)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', marginBottom: 10 }}>How to read this page</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
          {[
            { icon: '🔴', label: 'Red dot on a category', desc: 'You have only ONE supplier for this category. No backup exists.' },
            { icon: '🟣', label: 'Bright purple cell', desc: 'Heavy dependence on a single zone. Disruptions there will affect you.' },
            { icon: '·', label: 'Empty (dot) cell', desc: 'No supplier in this zone for that category. Could be a gap to fill.' },
            { icon: '📊', label: 'Bar chart', desc: 'How much of a category comes from one dominant zone. Longer bar = higher risk.' },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', gap: 10 }}>
              <span style={{ fontSize: 15, flexShrink: 0, marginTop: 2 }}>{item.icon}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-pri)', marginBottom: 2 }}>{item.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-sec)', lineHeight: 1.5 }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="Total Suppliers" value={summary.total_suppliers} sub="Across all categories and zones" />
        <StatCard label="Supply Categories" value={summary.total_categories} sub="Types of goods or services" />
        <StatCard label="Sourcing Zones" value={summary.total_zones} sub="Geographic sourcing regions" />
        <StatCard
          label="Single-Source Risk"
          value={summary.single_source_count}
          color={summary.single_source_count > 0 ? 'var(--danger)' : 'var(--success)'}
          sub={summary.single_source_count > 0 ? 'Categories with only 1 supplier — fix these first' : 'All categories have backups'}
        />
        <StatCard
          label="High Concentration"
          value={summary.high_concentration_count}
          color={summary.high_concentration_count > 0 ? 'var(--warning)' : 'var(--success)'}
          sub={summary.high_concentration_count > 0 ? 'Categories heavily zone-dependent' : 'Good zone spread'}
        />
      </div>

      {/* Single-source alert */}
      {single_source_categories.length > 0 && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)', marginBottom: 6 }}>⚠ Critical: Single-Source Categories</div>
          <div style={{ fontSize: 12, color: 'var(--text-sec)', marginBottom: 10, lineHeight: 1.6 }}>
            These categories have only one supplier. If that supplier faces any disruption — strike, insolvency, disaster —
            you have no fallback. <strong style={{ color: 'var(--text-pri)' }}>You should onboard at least one backup supplier for each of these.</strong>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {single_source_categories.map(cat => (
              <span key={cat} style={{ padding: '4px 12px', borderRadius: 12, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>
                {cat}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Heatmap */}
      <div className="panel">
        <PanelHeader label="Dependency Matrix — Category × Zone" accent="var(--primary)"
          right={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Click any cell for supplier names</span><InfoTooltip title="Supplier Dependency Heatmap" description="Shows how concentrated your supply chain is by category and geography. Dark cells mean many suppliers share the same category and zone — a single disruption there would have an outsized impact on your network." /></div>} />
        <div style={{ padding: 16, overflowX: 'auto' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: `180px repeat(${zones.length}, minmax(90px, 1fr))`,
            gap: 4,
            minWidth: 180 + zones.length * 94,
          }}>
            <div />
            {zones.map(z => (
              <div key={z} className="mono" style={{ fontSize: 11, color: 'var(--text-sec)', textAlign: 'center', padding: '4px 2px', fontWeight: 600 }}>{z}</div>
            ))}

            {categories.map(cat => {
              const isSingle = single_source_categories.includes(cat)
              return (
                <React.Fragment key={cat}>
                  <div style={{ fontSize: 11, color: isSingle ? 'var(--danger)' : 'var(--text-pri)', display: 'flex', alignItems: 'center', gap: 5, fontWeight: isSingle ? 600 : 400, paddingRight: 8 }}>
                    {isSingle && <span style={{ color: 'var(--danger)', fontSize: 8 }}>●</span>}
                    {cat}
                  </div>
                  {zones.map(z => {
                    const key = `${cat}|${z}`
                    const cell = cellMap[key]
                    const intensity = cell ? cell.dependency_score / maxScore : 0
                    const isSel = selectedCell === key
                    return (
                      <div key={z}
                        onClick={() => setSelectedCell(isSel ? null : cell ? key : null)}
                        title={cell ? `${cell.suppliers.join(', ')}` : 'No supplier in this zone'}
                        style={{
                          background: cell ? `rgba(124,107,255,${0.15 + intensity * 0.8})` : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${isSel ? 'var(--primary)' : cell ? 'var(--glass-border-bright)' : 'var(--glass-border)'}`,
                          borderRadius: 4, minHeight: 50,
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center',
                          cursor: cell ? 'pointer' : 'default',
                          outline: isSel ? '2px solid var(--primary)' : 'none',
                        }}>
                        {cell ? (
                          <>
                            <span style={{ fontSize: 15, color: '#fff', fontWeight: 700 }}>{cell.supplier_count}</span>
                            <span className="mono" style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', marginTop: 1 }}>
                              {cell.supplier_count === 1 ? 'supplier' : 'suppliers'}
                            </span>
                          </>
                        ) : (
                          <span style={{ color: 'var(--text-faint)', fontSize: 14 }}>·</span>
                        )}
                      </div>
                    )
                  })}
                </React.Fragment>
              )
            })}
          </div>

          {/* Cell detail popout */}
          {selectedCell && cellDetail && (
            <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 8, background: 'rgba(124,107,255,0.1)', border: '1px solid rgba(124,107,255,0.35)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--primary)' }}>{cellCategory} in {cellZone}</div>
                <button onClick={() => setSelectedCell(null)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16 }}>×</button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-sec)', marginBottom: 8, lineHeight: 1.6 }}>
                You have <strong style={{ color: 'var(--text-pri)' }}>{cellDetail.supplier_count} supplier{cellDetail.supplier_count > 1 ? 's' : ''}</strong> covering
                {' '}<em>{cellCategory}</em> in the {cellZone} zone:
                {' '}<strong style={{ color: 'var(--text-pri)' }}>{cellDetail.suppliers.join(', ')}</strong>.
              </div>
              {single_source_categories.includes(cellCategory) && (
                <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600, marginTop: 6 }}>
                  ⚠ This is your only supplier for {cellCategory}. Consider onboarding a backup in a different zone.
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 10 }}>
            Numbers = supplier count per category × zone. Red dot = only one supplier (single-source risk). Brighter cell = heavier dependence.
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14 }}>
        {/* Concentration bar chart */}
        <div className="panel">
          <PanelHeader label="Zone Concentration by Category" accent="var(--warning)" right={<InfoTooltip title="Zone Concentration" description="For each product category, this shows what percentage of your supply comes from a single dominant zone. A long bar means high concentration — one regional disruption could wipe out that entire category." />} />
          <div style={{ padding: '6px 16px 4px', fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.5 }}>
            How much of each category is sourced from one dominant zone. A bar reaching 100% means
            everything comes from one place — the highest-risk scenario.
          </div>
          <div style={{ padding: '8px 16px 16px' }}>
            <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 36)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 50 }}>
                <XAxis type="number" domain={[0, 100]}
                  tick={{ fill: 'var(--text-dim)', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={{ stroke: 'var(--glass-border)' }} tickLine={false} />
                <YAxis type="category" dataKey="category" width={120}
                  tick={{ fill: 'var(--text-sec)', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: 'rgba(6,9,24,0.97)', border: '1px solid rgba(124,107,255,0.4)', borderRadius: 8, fontSize: 12, color: '#e2e8f0' }}
                  formatter={v => [`${v}% from dominant zone`]}
                  labelStyle={{ color: '#a78bfa', fontWeight: 700, marginBottom: 4 }}
                  itemStyle={{ color: '#e2e8f0' }}
                  cursor={{ fill: 'rgba(124,107,255,0.07)' }} />
                <Bar dataKey="share" radius={[0, 4, 4, 0]}>
                  {chartData.map((d, i) => <Cell key={i} fill={RISK_COLOR[d.risk]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Risk detail table */}
        <div className="panel">
          <PanelHeader label="Risk Detail by Category" accent="var(--danger)" right={<InfoTooltip title="Category Risk Breakdown" description="Detailed risk metrics per supply category — number of suppliers, zones covered, average buffer stock, and reliability. Red rows require immediate attention as they represent your most fragile supply categories." />} />
          <div style={{ padding: '6px 16px 8px', fontSize: 12, color: 'var(--text-sec)' }}>
            The dominant zone and what the risk level means for each supply category.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Dominant Zone</th>
                  <th>Zone Share</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {concentration_risks.map(r => (
                  <React.Fragment key={r.category}>
                    <tr>
                      <td style={{ color: single_source_categories.includes(r.category) ? 'var(--danger)' : 'var(--text-pri)', fontWeight: single_source_categories.includes(r.category) ? 600 : 400 }}>
                        {single_source_categories.includes(r.category) && <span style={{ marginRight: 5, fontSize: 9 }}>●</span>}
                        {r.category}
                      </td>
                      <td className="c-sec">{r.dominant_zone}</td>
                      <td className="mono" style={{ color: RISK_COLOR[r.risk_level] }}>{r.share_pct}%</td>
                      <td><Tag color={RISK_COLOR[r.risk_level]}>{r.risk_level}</Tag></td>
                    </tr>
                    <tr>
                      <td colSpan="4" style={{ padding: '0 12px 10px', fontSize: 11, color: 'var(--text-dim)', borderBottom: '1px solid var(--glass-border)' }}>
                        {RISK_PLAIN[r.risk_level]}
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Next steps */}
      <div className="panel panel-pad">
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-pri)', marginBottom: 12 }}>What You Should Do Next</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
          {single_source_categories.length > 0 && (
            <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)', marginBottom: 6 }}>🔴 Add Backup Suppliers</div>
              <div style={{ fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.65 }}>
                These categories have zero fallback: <strong>{single_source_categories.join(', ')}</strong>.
                Go to Suppliers and onboard at least one alternative in a different zone.
              </div>
            </div>
          )}
          {highCount > 0 && (
            <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--warning)', marginBottom: 6 }}>🟡 Spread Your Sourcing</div>
              <div style={{ fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.65 }}>
                {highCount} categories rely heavily on one region. Look for suppliers in alternate zones to
                reduce the impact of a regional disruption.
              </div>
            </div>
          )}
          <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(45,212,191,0.06)', border: '1px solid rgba(45,212,191,0.15)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)', marginBottom: 6 }}>✓ Stay on Top of It</div>
            <div style={{ fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.65 }}>
              Check this page whenever you add new suppliers or after a disruption event resolves.
              The goal: no red dots, no bars above 70%.
            </div>
          </div>
        </div>
      </div>

      <InsightsPanel
        intro="This page focuses on category concentration. Below is the wider view across your whole supply base — buffer, reliability, and single-site risks too — generated automatically from your own supplier data."
      />
    </div>
  )
}
