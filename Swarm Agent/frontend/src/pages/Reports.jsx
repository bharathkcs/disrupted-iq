import React, { useEffect, useMemo, useState } from 'react'
import {
  Bar, BarChart, Cell, CartesianGrid, Legend, Line, LineChart, Pie, PieChart,
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../services/api.js'
import { PanelHeader, Tag, InfoTooltip } from '../components/ui.jsx'
import { generateInsights } from '../components/InsightsPanel.jsx'

export function exportToCSV(data, filename) {
  if (!data || data.length === 0) return
  const keys = Object.keys(data[0])
  const header = keys.join(',')
  const rows = data.map(row =>
    keys.map(k => {
      const v = row[k]
      const str = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')
      return str.includes(',') ? `"${str}"` : str
    }).join(','),
  )
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const DATASET_TABS = [['sb', '📦 Supply Base Analysis']]
const PERF_TABS = [
  ['r01', 'All Disruptions'],
  ['r02', 'Team Performance'],
  ['r03', 'Learning Accuracy'],
  ['r04', 'Decision Confidence'],
  ['r05', 'What-If Scenarios'],
  ['r06', 'Chain Reactions'],
  ['r07', 'Actual vs Predicted'],
  ['r08', 'Your Decisions'],
  ['r09', 'Prediction Accuracy'],
  ['r10', 'AI Compliance'],
]

const TAB_ICONS = {
  sb: '📦',
  r01: '⚡',
  r02: '🚀',
  r03: '🧠',
  r04: '⚖️',
  r05: '🎲',
  r06: '🔗',
  r07: '📊',
  r08: '✅',
  r09: '📈',
  r10: '🛡️',
}

const TAB_EXPLAIN = {
  sb: 'Built entirely from the suppliers you uploaded — no demo data. This is your supply base, profiled and scored so you can see where your real risk sits.',
  r01: 'A complete log of every disruption your supply chain has faced, with severity, source, and outcome.',
  r02: 'How fast and how well the AI swarm performed across your events — response time, option quality, and questions asked.',
  r03: 'How accurately the AI recalls and applies lessons from past events to new ones.',
  r04: 'How often the AI experts disagreed, and how big those disagreements were — a measure of decision confidence.',
  r05: 'Accuracy of the Monte Carlo what-if simulations against what actually happened.',
  r06: 'Detected chain-reaction events where one disruption amplified another through shared suppliers.',
  r07: 'For resolved events, how the AI prediction compared against the real-world outcome.',
  r08: 'Every human approval decision — which option was chosen, by whom, and under what conditions.',
  r09: 'Overall forecast accuracy: predicted vs. actual demand shift across all resolved events.',
  r10: 'AI Compliance & Audit Report — procurement-grade scorecard covering HIL approvals, co-reviewer sign-offs, content-safety pass rate, memory provenance, auto-trigger coverage, and counterfactual closure.',
}

const CHART_COLORS = ['#7C6BFF', '#2DD4BF', '#60A5FA', '#F59E0B', '#F472B6', '#C084FC', '#34D399', '#FB923C']

function StatCard({ label, value, accent = 'var(--primary)', sub, icon }) {
  return (
    <div className="panel" style={{
      padding: '16px 18px',
      background: `linear-gradient(135deg, ${accent}18 0%, rgba(255,255,255,0.03) 60%)`,
      border: `1px solid ${accent}40`,
      borderRadius: 12,
      position: 'relative',
      overflow: 'hidden',
      transition: 'all 0.35s cubic-bezier(0.23, 1, 0.320, 1)',
      boxShadow: `inset 0 0 16px ${accent}08, 0 0 1px ${accent}30`,
    }}
    onMouseOver={(e) => {
      e.currentTarget.style.transform = 'translateY(-3px)'
      e.currentTarget.style.boxShadow = `inset 0 0 24px ${accent}14, 0 0 1px ${accent}50, 0 0 24px ${accent}35`
      e.currentTarget.style.borderColor = `${accent}60`
      e.currentTarget.style.background = `linear-gradient(135deg, ${accent}20 0%, rgba(255,255,255,0.04) 60%)`
    }}
    onMouseOut={(e) => {
      e.currentTarget.style.transform = 'translateY(0)'
      e.currentTarget.style.boxShadow = `inset 0 0 16px ${accent}08, 0 0 1px ${accent}30`
      e.currentTarget.style.borderColor = `${accent}40`
      e.currentTarget.style.background = `linear-gradient(135deg, ${accent}18 0%, rgba(255,255,255,0.03) 60%)`
    }}
    >
      <div style={{ position: 'absolute', right: -8, top: -8, fontSize: 46, opacity: 0.08 }}>{icon}</div>
      <div className="eyebrow" style={{ color: 'var(--text-dim)' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: accent, marginTop: 6, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function ChartCard({ title, accent, height = 260, children, subtitle }) {
  return (
    <div className="panel">
      <PanelHeader label={title} accent={accent} />
      {subtitle && <div style={{ padding: '8px 16px 0', fontSize: 12, color: 'var(--text-dim)' }}>{subtitle}</div>}
      <div style={{ height, padding: 12 }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </div>
  )
}

const tooltipStyle = { background: 'var(--bg-solid)', border: '1px solid var(--glass-border)', borderRadius: 8 }

function ReportTable({ columns, rows, exportName, title = 'Detailed Data' }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="label">{title}</span>
        <button className="btn btn-sm btn-ghost" onClick={() => exportToCSV(rows, exportName)}>⬇ Export CSV</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>{columns.map(col => <th key={col.key}>{col.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx}>
                {columns.map(col => <td key={col.key}>{col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Dataset-driven supply base analytics (computed purely from uploaded suppliers) ───
function supplierHealth(s) {
  const rel = s.reliability || 0
  const buf = Math.min((s.buffer_stock_days || 0) / 30, 1) * 100
  const site = (s.sites || 1) >= 2 ? 100 : 55
  return Math.round(rel * 0.5 + buf * 0.3 + site * 0.2)
}

function healthTier(score) {
  if (score >= 80) return { label: 'Strong', color: 'var(--success)' }
  if (score >= 60) return { label: 'Moderate', color: 'var(--warning)' }
  return { label: 'Weak', color: 'var(--danger)' }
}

function analyseSupplyBase(suppliers) {
  const total = suppliers.length
  if (total === 0) return null

  const zoneMap = {}
  const catMap = {}
  suppliers.forEach(s => {
    zoneMap[s.zone || 'Unknown'] = (zoneMap[s.zone || 'Unknown'] || 0) + 1
    ;(s.categories || []).forEach(c => {
      const k = String(c).trim()
      if (k) catMap[k] = (catMap[k] || 0) + 1
    })
  })

  const avgReliability = Math.round(suppliers.reduce((a, s) => a + (s.reliability || 0), 0) / total)
  const avgBuffer = Math.round(suppliers.reduce((a, s) => a + (s.buffer_stock_days || 0), 0) / total)
  const singleSource = Object.entries(catMap).filter(([, n]) => n === 1).map(([c]) => c)
  const singleSite = suppliers.filter(s => (s.sites || 1) <= 1).length

  const relBuckets = [
    { name: '<70%', value: suppliers.filter(s => (s.reliability || 0) < 70).length, fill: '#FF6B6B' },
    { name: '70–85%', value: suppliers.filter(s => (s.reliability || 0) >= 70 && (s.reliability || 0) < 85).length, fill: '#F59E0B' },
    { name: '85–95%', value: suppliers.filter(s => (s.reliability || 0) >= 85 && (s.reliability || 0) < 95).length, fill: '#60A5FA' },
    { name: '95%+', value: suppliers.filter(s => (s.reliability || 0) >= 95).length, fill: '#2DD4BF' },
  ]
  const bufBuckets = [
    { name: '<7d', value: suppliers.filter(s => (s.buffer_stock_days || 0) < 7).length, fill: '#FF6B6B' },
    { name: '7–14d', value: suppliers.filter(s => (s.buffer_stock_days || 0) >= 7 && (s.buffer_stock_days || 0) < 14).length, fill: '#F59E0B' },
    { name: '14–30d', value: suppliers.filter(s => (s.buffer_stock_days || 0) >= 14 && (s.buffer_stock_days || 0) < 30).length, fill: '#60A5FA' },
    { name: '30d+', value: suppliers.filter(s => (s.buffer_stock_days || 0) >= 30).length, fill: '#2DD4BF' },
  ]

  const byRegion = Object.entries(zoneMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  const byCategory = Object.entries(catMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10)

  const tiers = { Strong: 0, Moderate: 0, Weak: 0 }
  const scored = suppliers.map(s => {
    const score = supplierHealth(s)
    tiers[healthTier(score).label]++
    return { ...s, health: score, tier: healthTier(score).label, categories_text: (s.categories || []).join(', ') }
  }).sort((a, b) => a.health - b.health)
  const tierData = Object.entries(tiers).map(([name, value]) => ({ name, value }))

  const topZonePct = byRegion.length ? Math.round((byRegion[0].count / total) * 100) : 0
  const overallHealth = Math.round(scored.reduce((a, s) => a + s.health, 0) / total)

  return {
    total, regions: byRegion.length, categories: Object.keys(catMap).length,
    avgReliability, avgBuffer, singleSource, singleSite,
    relBuckets, bufBuckets, byRegion, byCategory, tierData, scored,
    topZone: byRegion[0]?.name, topZonePct, overallHealth,
    insights: generateInsights(suppliers),
  }
}

const INSIGHT_COLOR = { critical: 'var(--danger)', warning: 'var(--warning)', info: 'var(--info)', good: 'var(--success)' }

function SupplyBaseReport({ suppliers }) {
  if (!suppliers) return <div className="panel panel-pad"><span className="mono c-dim">Loading your supplier data…</span></div>
  const a = analyseSupplyBase(suppliers)
  if (!a) {
    return (
      <div className="panel panel-pad" style={{ textAlign: 'center', padding: 48 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-pri)', marginBottom: 8 }}>No suppliers to analyse yet</div>
        <div style={{ fontSize: 14, color: 'var(--text-sec)', maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
          This report is built entirely from your uploaded supplier list. Head to <strong>Configuration → Add Suppliers via Excel</strong> to
          upload your data, then come back to see a full profile of your supply base — concentration, reliability, buffer health, and your biggest risks.
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="panel panel-pad" style={{ borderLeft: '4px solid var(--primary)' }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-pri)' }}>Supply Base Analysis</div>
        <div style={{ fontSize: 13, color: 'var(--text-sec)', marginTop: 4, maxWidth: 760, lineHeight: 1.6 }}>
          A complete profile of the {a.total} supplier{a.total !== 1 ? 's' : ''} you uploaded — scored and broken down by region, category,
          reliability, and buffer stock. Everything here is calculated from your own data.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
        <StatCard label="Suppliers" value={a.total} accent="#7C6BFF" icon="📦" sub="In your uploaded list" />
        <StatCard label="Overall Health" value={`${a.overallHealth}/100`} accent={healthTier(a.overallHealth).color} icon="💪" sub={`${healthTier(a.overallHealth).label} supply base`} />
        <StatCard label="Regions" value={a.regions} accent="#60A5FA" icon="🗺️" sub={`Top: ${a.topZone} (${a.topZonePct}%)`} />
        <StatCard label="Categories" value={a.categories} accent="#2DD4BF" icon="🏷️" sub="Distinct supply categories" />
        <StatCard label="Avg Reliability" value={`${a.avgReliability}%`} accent={a.avgReliability >= 85 ? '#2DD4BF' : '#F59E0B'} icon="✓" sub="Across all suppliers" />
        <StatCard label="Avg Buffer" value={`${a.avgBuffer}d`} accent={a.avgBuffer >= 14 ? '#2DD4BF' : '#F59E0B'} icon="📅" sub="Days of stock on hand" />
        <StatCard label="Single-Source" value={a.singleSource.length} accent={a.singleSource.length ? '#FF6B6B' : '#2DD4BF'} icon="⚠" sub="Categories with no backup" />
        <StatCard label="Single-Site" value={a.singleSite} accent={a.singleSite ? '#F59E0B' : '#2DD4BF'} icon="🏭" sub="Suppliers with one site" />
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <ChartCard title="Suppliers by Region" accent="#60A5FA" subtitle="Where your supply base is geographically concentrated">
          <BarChart data={a.byRegion}><CartesianGrid stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-dim)' }} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-dim)' }} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="count" radius={[6, 6, 0, 0]}>{a.byRegion.map((e, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Bar></BarChart>
        </ChartCard>
        <ChartCard title="Supplier Health Tiers" accent="#2DD4BF" subtitle="How many suppliers are strong, moderate, or weak">
          <PieChart><Pie data={a.tierData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={3}>{a.tierData.map((e) => <Cell key={e.name} fill={{ Strong: '#2DD4BF', Moderate: '#F59E0B', Weak: '#FF6B6B' }[e.name]} />)}</Pie><Tooltip contentStyle={tooltipStyle} /><Legend /></PieChart>
        </ChartCard>
        <ChartCard title="Reliability Distribution" accent="#7C6BFF" subtitle="Spread of supplier reliability scores">
          <BarChart data={a.relBuckets}><CartesianGrid stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-dim)' }} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-dim)' }} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="value" radius={[6, 6, 0, 0]}>{a.relBuckets.map((e, i) => <Cell key={i} fill={e.fill} />)}</Bar></BarChart>
        </ChartCard>
        <ChartCard title="Buffer Stock Distribution" accent="#F59E0B" subtitle="How much breathing room your suppliers give you">
          <BarChart data={a.bufBuckets}><CartesianGrid stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-dim)' }} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-dim)' }} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="value" radius={[6, 6, 0, 0]}>{a.bufBuckets.map((e, i) => <Cell key={i} fill={e.fill} />)}</Bar></BarChart>
        </ChartCard>
      </div>

      {a.byCategory.length > 0 && (
        <ChartCard title="Category Coverage" accent="#F472B6" height={Math.max(220, a.byCategory.length * 34)} subtitle="How many suppliers cover each category — short red bars are single points of failure">
          <BarChart layout="vertical" data={a.byCategory} margin={{ left: 20 }}><CartesianGrid stroke="rgba(255,255,255,0.06)" /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-dim)' }} /><YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: 'var(--text-sec)' }} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="count" radius={[0, 6, 6, 0]}>{a.byCategory.map((e, i) => <Cell key={i} fill={e.count === 1 ? '#FF6B6B' : CHART_COLORS[i % CHART_COLORS.length]} />)}</Bar></BarChart>
        </ChartCard>
      )}

      <ReportTable
        title="Every Supplier, Scored"
        exportName="supply-base-analysis.csv"
        rows={a.scored.map(s => ({ name: s.name, zone: s.zone, categories: s.categories_text, reliability: s.reliability, buffer_stock_days: s.buffer_stock_days, sites: s.sites, health: s.health, tier: s.tier }))}
        columns={[
          { key: 'name', label: 'Supplier' },
          { key: 'zone', label: 'Region' },
          { key: 'categories', label: 'Categories' },
          { key: 'reliability', label: 'Reliability', render: v => `${v}%` },
          { key: 'buffer_stock_days', label: 'Buffer', render: v => `${v}d` },
          { key: 'sites', label: 'Sites' },
          { key: 'health', label: 'Health', render: v => <span style={{ fontWeight: 700, color: healthTier(v).color }}>{v}</span> },
          { key: 'tier', label: 'Tier', render: (v) => <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: `${healthTier(v === 'Strong' ? 85 : v === 'Moderate' ? 65 : 40).color}22`, color: healthTier(v === 'Strong' ? 85 : v === 'Moderate' ? 65 : 40).color }}>{v}</span> },
        ]}
      />
    </>
  )
}

export default function Reports() {
  const [activeTab, setActiveTab] = useState('sb')
  const [filters, setFilters] = useState({ geography: '', source: '', severity_min: 1, severity_max: 10 })
  const [data, setData] = useState({})
  const [suppliers, setSuppliers] = useState(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const loadSuppliers = async () => {
    try {
      const res = await api.suppliers()
      setSuppliers(Array.isArray(res) ? res : (res?.suppliers || []))
    } catch (err) {
      setSuppliers([])
    }
  }

  const loadReport = async () => {
    if (activeTab === 'sb') return
    try {
      setIsRefreshing(true)
      const loaders = {
        r01: () => api.reportEventLog({
          ...(filters.geography ? { geography: filters.geography } : {}),
          ...(filters.source ? { source: filters.source } : {}),
          severity_min: String(filters.severity_min),
        }),
        r02: api.reportSwarmPerformance,
        r03: api.reportMemoryAccuracy,
        r04: api.reportDissent,
        r05: api.reportSimulation,
        r06: api.reportCascade,
        r07: api.reportCounterfactual,
        r08: api.reportHilDecisions,
        r09: api.reportForecastAccuracy,
        r10: api.reportCompliance,
      }
      const result = await loaders[activeTab]()
      setData(prev => ({ ...prev, [activeTab]: result }))
    } catch (err) {
      console.error('Report load error:', err)
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    loadSuppliers()
  }, [])

  useEffect(() => {
    if (activeTab === 'sb') return
    let alive = true
    loadReport()
    const t = setInterval(() => { if (alive) loadReport() }, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [activeTab, filters])

  const current = data[activeTab]

  const content = useMemo(() => {
    if (activeTab === 'sb') return <SupplyBaseReport suppliers={suppliers} />
    if (!current) return <div className="panel panel-pad"><span className="mono c-dim">Loading report…</span></div>

    // Show empty state for event-based reports when no events exist
    if (Array.isArray(current) && current.length === 0) {
      return (
        <div className="panel panel-pad" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-pri)', marginBottom: 8 }}>No events to report yet</div>
          <div style={{ fontSize: 14, color: 'var(--text-sec)', maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
            {activeTab === 'r01' ? 'Once you trigger disruption events and resolve them, this log will show the complete history.' :
             activeTab === 'r02' ? 'Swarm performance metrics appear after your first disruption event.' :
             activeTab === 'r03' ? 'Memory accuracy tracking begins after your first resolved event.' :
             activeTab === 'r04' ? 'Expert disagreement analysis shows up after events are processed.' :
             activeTab === 'r05' ? 'Simulation accuracy metrics appear after your first event.' :
             activeTab === 'r06' ? 'Chain reaction detection begins when you have multiple overlapping events.' :
             activeTab === 'r07' ? 'Actual vs predicted comparisons appear after resolving events.' :
             activeTab === 'r08' ? 'Your approval decisions will be logged as you handle disruptions.' :
             activeTab === 'r09' ? 'Forecast accuracy improves as you resolve more events.' :
             activeTab === 'r10' ? 'Compliance metrics populate after your first events. Trigger and resolve a disruption to see the audit scorecard.' :
             'Report data will appear here.'}
          </div>
        </div>
      )
    }

    // Handle non-array empty objects (shouldn't happen but safeguard)
    if (typeof current === 'object' && Object.keys(current).length === 0) {
      return (
        <div className="panel panel-pad" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 14, color: 'var(--text-sec)' }}>No data available for this report</div>
        </div>
      )
    }

    if (activeTab === 'r01') {
      const rows = current.filter(row => row.severity <= filters.severity_max)
      return (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            <StatCard label="Total Disruptions" value={rows.length} accent="#7C6BFF" icon="⚡" />
            <StatCard label="Escalated" value={rows.filter(r => r.escalated).length} accent="#FF6B6B" icon="🔺" />
            <StatCard label="Chain Reactions" value={rows.filter(r => r.cascade_flag).length} accent="#F472B6" icon="🔗" />
            <StatCard label="Avg Risk Level" value={rows.length ? (rows.reduce((a, r) => a + (r.severity || 0), 0) / rows.length).toFixed(1) : '0.0'} accent="#F59E0B" icon="📊" />
          </div>
          <div className="panel panel-pad" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10 }}>
            <input placeholder="Search geography" value={filters.geography} onChange={e => setFilters(prev => ({ ...prev, geography: e.target.value }))} />
            <select value={filters.source} onChange={e => setFilters(prev => ({ ...prev, source: e.target.value }))}>
              <option value="">All Sources</option>
              <option value="NewsAPI">NewsAPI</option>
              <option value="Open-Meteo">Open-Meteo</option>
              <option value="Manual">Manual</option>
              <option value="Demo">Demo</option>
            </select>
            <input type="number" min="1" max="10" value={filters.severity_min} onChange={e => setFilters(prev => ({ ...prev, severity_min: Number(e.target.value) }))} />
            <input type="number" min="1" max="10" value={filters.severity_max} onChange={e => setFilters(prev => ({ ...prev, severity_max: Number(e.target.value) }))} />
          </div>
          <ReportTable
            exportName="r01-event-log.csv"
            rows={rows}
            columns={[
              { key: 'event_id', label: 'Event ID' },
              { key: 'source', label: 'Source' },
              { key: 'geography', label: 'Geography' },
              { key: 'severity', label: 'Severity' },
              { key: 'type', label: 'Type' },
              { key: 'cascade_flag', label: 'Cascade' },
              { key: 'status', label: 'Status' },
              { key: 'timestamp_utc', label: 'Time' },
            ]}
          />
        </>
      )
    }

    if (activeTab === 'r02') {
      const geoData = Object.entries(current.events_by_geography || {}).map(([name, count]) => ({ name, count }))
      const sourceData = Object.entries(current.source_breakdown || {}).map(([name, value]) => ({ name, value }))
      return (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            <StatCard label="Avg Response Time" value={`${current.avg_execution_time_seconds}s`} accent="#7C6BFF" icon="⏱️" />
            <StatCard label="Response Speed %" value={current.sla_compliance_rate_pct} accent="#2DD4BF" icon="🚀" />
            <StatCard label="Options Quality %" value={current.validator_pass_rate_pct} accent="#60A5FA" icon="✓" />
            <StatCard label="Questions Asked" value={current.nl_query_total} accent="#F59E0B" icon="💬" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <ChartCard title="Execution Time Trend" accent="var(--primary)"><LineChart data={current.recent_metrics || []}><CartesianGrid stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="event_id" hide /><YAxis tick={{ fontSize: 11, fill: 'var(--text-dim)' }} /><Tooltip contentStyle={tooltipStyle} /><Line type="monotone" dataKey="total_duration_seconds" stroke="#7C6BFF" strokeWidth={2} dot={false} /></LineChart></ChartCard>
            <ChartCard title="Events by Geography" accent="var(--info)"><BarChart data={geoData}><CartesianGrid stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="name" hide /><YAxis tick={{ fontSize: 11, fill: 'var(--text-dim)' }} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="count" fill="#60A5FA" radius={[6, 6, 0, 0]} /></BarChart></ChartCard>
            <ChartCard title="Source Breakdown" accent="var(--success)"><PieChart><Pie data={sourceData} dataKey="value" nameKey="name" outerRadius={80}>{sourceData.map((entry, idx) => <Cell key={entry.name} fill={CHART_COLORS[idx % CHART_COLORS.length]} />)}</Pie><Tooltip contentStyle={tooltipStyle} /><Legend /></PieChart></ChartCard>
          </div>
          <ReportTable exportName="r02-performance.csv" rows={current.recent_metrics || []} columns={[
            { key: 'event_id', label: 'Event' },
            { key: 'total_duration_seconds', label: 'Duration' },
            { key: 'sla_met', label: 'SLA Met' },
            { key: 'validator_reruns', label: 'Reruns' },
            { key: 'news_source', label: 'Source' },
          ]} />
        </>
      )
    }

    if (activeTab === 'r03') {
      return (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            <StatCard label="Past Experiences" value={current.total_memory_records} accent="#7C6BFF" icon="🧠" />
            <StatCard label="Recall Rate %" value={current.memory_recall_rate_pct} accent="#2DD4BF" icon="🔁" />
            <StatCard label="Used in Decisions %" value={current.memory_adjustment_application_rate_pct} accent="#60A5FA" icon="🎯" />
            <StatCard label="Regions Covered" value={(current.geographies_covered || []).length} accent="#F59E0B" icon="🗺️" />
          </div>
          <ReportTable exportName="r03-memory.csv" rows={current.prediction_vs_actual || []} columns={[
            { key: 'memory_id', label: 'Memory ID' },
            { key: 'event_type', label: 'Event Type' },
            { key: 'geography', label: 'Geography' },
            { key: 'predicted_demand_shift', label: 'Predicted %' },
            { key: 'actual_demand_shift', label: 'Actual %' },
            { key: 'variance_pct', label: 'Variance %', render: value => <span style={{ color: Math.abs(value) <= 5 ? 'var(--success)' : Math.abs(value) <= 15 ? 'var(--warning)' : 'var(--danger)' }}>{value}</span> },
          ]} />
        </>
      )
    }

    if (activeTab === 'r04') {
      const bucketData = Object.entries(current.divergence_score_distribution || {}).map(([name, value]) => ({ name, value }))
      return (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            <StatCard label="Expert Disagreement %" value={current.dissent_detection_rate_pct} accent="#C084FC" icon="⚖️" />
            <StatCard label="Events Analyzed" value={current.total_events_analyzed} accent="#7C6BFF" icon="📊" />
            <StatCard label="Avg Disagreement" value={current.avg_divergence_score_when_dissent} accent="#F59E0B" icon="📈" />
            <StatCard label="Sensitivity Threshold" value={current.current_threshold} accent="#60A5FA" icon="🎚️" />
          </div>
          <ChartCard title="Divergence Score Distribution" accent="var(--purple)"><BarChart data={bucketData}><CartesianGrid stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-dim)' }} /><YAxis tick={{ fontSize: 11, fill: 'var(--text-dim)' }} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="value" fill="#C084FC" radius={[6, 6, 0, 0]} /></BarChart></ChartCard>
          <ReportTable exportName="r04-dissent.csv" rows={current.dissent_events || []} columns={[
            { key: 'event_id', label: 'Event' },
            { key: 'geography', label: 'Geography' },
            { key: 'severity', label: 'Severity' },
            { key: 'divergence_score', label: 'Divergence' },
            { key: 'timestamp_utc', label: 'Time' },
          ]} />
        </>
      )
    }

    if (activeTab === 'r05') {
      return (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            <StatCard label="Scenarios Tested" value={current.total_simulations_run} accent="#7C6BFF" icon="🎲" />
            <StatCard label="Response Speed %" value={current.sla_compliance_rate_pct} accent="#2DD4BF" icon="🚀" />
            <StatCard label="Probability Accuracy %" value={current.probability_validity_rate_pct} accent="#60A5FA" icon="🎯" />
            <StatCard label="Adjustment Signals %" value={current.recalibration_rate_pct} accent="#F59E0B" icon="🔧" />
          </div>
          <ReportTable exportName="r05-simulation.csv" rows={current.counterfactual_records || []} columns={[
            { key: 'counterfactual_id', label: 'CF ID' },
            { key: 'event_id', label: 'Event ID' },
            { key: 'actual_outcome', label: 'Actual Outcome' },
            { key: 'recalibration_recommended', label: 'Recalibration' },
            { key: 'learning_signal', label: 'Learning Signal' },
            { key: 'timestamp_utc', label: 'Date' },
          ]} />
        </>
      )
    }

    if (activeTab === 'r06') {
      const typeData = Object.entries(current.cascade_type_breakdown || {}).map(([name, value]) => ({ name, value }))
      return (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            <StatCard label="Chain Reactions" value={current.total_cascade_events} accent="#F472B6" icon="🔗" />
            <StatCard label="Chain Reaction Rate %" value={current.cascade_rate_pct} accent="#7C6BFF" icon="📊" />
            <StatCard label="Most Common Type" value={typeData.sort((a, b) => b.value - a.value)[0]?.name || 'None'} accent="#60A5FA" icon="🏷️" />
            <StatCard label="Max Combined Risk" value={current.max_combined_severity} accent="#FF6B6B" icon="🔺" />
          </div>
          <ChartCard title="Cascade Type Breakdown" accent="var(--pink)"><PieChart><Pie data={typeData} dataKey="value" nameKey="name" outerRadius={80}>{typeData.map((entry, idx) => <Cell key={entry.name} fill={CHART_COLORS[idx % CHART_COLORS.length]} />)}</Pie><Tooltip contentStyle={tooltipStyle} /><Legend /></PieChart></ChartCard>
          <ReportTable exportName="r06-cascade.csv" rows={(current.cascade_events || []).map(row => ({ ...row, shared_suppliers_count: (row.shared_suppliers || []).length }))} columns={[
            { key: 'cascade_type', label: 'Type' },
            { key: 'combined_severity_score', label: 'Combined Severity' },
            { key: 'overlap_zone', label: 'Overlap Zone' },
            { key: 'shared_suppliers_count', label: 'Shared Suppliers' },
          ]} />
        </>
      )
    }

    if (activeTab === 'r07') {
      return (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            <StatCard label="Results Recorded" value={current.total_counterfactuals} accent="#7C6BFF" icon="📋" />
            <StatCard label="Adjustment Signals %" value={current.recalibration_rate_pct} accent="#F59E0B" icon="🔧" />
            <StatCard label="Learning Insights" value={(current.learning_signal_summary || []).length} accent="#2DD4BF" icon="💡" />
            <StatCard label="Avg Resolution Hours" value={current.avg_resolution_time_hours} accent="#60A5FA" icon="⏱️" />
          </div>
          <ReportTable exportName="r07-counterfactual.csv" rows={current.records || []} columns={[
            { key: 'counterfactual_id', label: 'CF ID' },
            { key: 'event_id', label: 'Event' },
            { key: 'actual_outcome', label: 'Outcome' },
            { key: 'prediction_variance', label: 'Variance Summary' },
            { key: 'recalibration_recommended', label: 'Recalibration' },
            { key: 'timestamp_utc', label: 'Date' },
          ]} />
        </>
      )
    }

    if (activeTab === 'r10') {
      const metrics = current.metrics || []
      const overallStatus = current.overall_status || 'red'
      const statusBg = { green: 'rgba(34,197,94,0.10)', amber: 'rgba(245,158,11,0.10)', red: 'rgba(239,68,68,0.10)' }
      const statusBorder = { green: 'rgba(34,197,94,0.35)', amber: 'rgba(245,158,11,0.35)', red: 'rgba(239,68,68,0.35)' }
      const statusColor = { green: '#22c55e', amber: '#f59e0b', red: '#ef4444' }
      return (
        <>
          <div className="panel" style={{
            padding: '18px 22px',
            background: statusBg[overallStatus],
            border: `1px solid ${statusBorder[overallStatus]}`,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}>
            <div>
              <div className="eyebrow" style={{ color: 'var(--text-dim)' }}>Overall Compliance</div>
              <div style={{ fontSize: 36, fontWeight: 800, color: statusColor[overallStatus] }}>
                {current.overall_compliance_pct}%
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-sec)', marginTop: 4 }}>
                Across {current.total_events_audited || 0} audited event{current.total_events_audited === 1 ? '' : 's'} · Report ID {current.report_id || 'R-10'}
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-sec)', maxWidth: 360, lineHeight: 1.55 }}>
              Procurement-grade scorecard. Each metric is derived from the existing audit log + memory store; no new data collection required.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginTop: 16 }}>
            {metrics.map(m => (
              <div key={m.metric_name} className="panel" style={{
                padding: '16px 18px',
                background: statusBg[m.status],
                border: `1px solid ${statusBorder[m.status]}`,
                borderRadius: 12,
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {m.metric_name}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 28, fontWeight: 800, color: statusColor[m.status] }}>{m.percent}%</span>
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    {m.value} of {m.denominator || 0}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.5 }}>
                  {m.description}
                </div>
              </div>
            ))}
          </div>
        </>
      )
    }

    if (activeTab === 'r08') {
      const optionData = Object.entries(current.option_selection_breakdown || {}).map(([name, value]) => ({ name, value }))
      return (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            <StatCard label="Total Approvals" value={current.total_confirmations} accent="#7C6BFF" icon="✅" />
            <StatCard label="Avg Questions/Session" value={current.avg_nl_queries_per_session} accent="#60A5FA" icon="💬" />
            <StatCard label="Second Review Rate %" value={current.total_confirmations ? ((current.co_review_completed_count / current.total_confirmations) * 100).toFixed(2) : '0.00'} accent="#2DD4BF" icon="👥" />
            <StatCard label="Top Option Selection %" value={current.total_confirmations ? ((current.option_selection_breakdown.option_1 / current.total_confirmations) * 100).toFixed(2) : '0.00'} accent="#F59E0B" icon="🥇" />
          </div>
          <ChartCard title="Option Selection Breakdown" accent="var(--warning)"><BarChart data={optionData}><CartesianGrid stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-dim)' }} /><YAxis tick={{ fontSize: 11, fill: 'var(--text-dim)' }} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="value" fill="#F59E0B" radius={[6, 6, 0, 0]} /></BarChart></ChartCard>
          <ReportTable exportName="r08-hil.csv" rows={current.hil_decisions || []} columns={[
            { key: 'reviewer_id', label: 'Reviewer' },
            { key: 'selected_option_rank', label: 'Option' },
            { key: 'severity', label: 'Severity' },
            { key: 'had_dissent', label: 'Dissent' },
            { key: 'had_cascade', label: 'Cascade' },
            { key: 'timestamp_utc', label: 'Time' },
          ]} />
        </>
      )
    }

    const scatterData = (current.forecast_accuracy || []).map(row => ({ ...row, color: row.absolute_error_pct <= 5 ? '#2DD4BF' : row.absolute_error_pct <= 15 ? '#F59E0B' : '#FF6B6B' }))
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          <StatCard label="Outcomes Recorded" value={current.total_events_with_actuals} accent="#7C6BFF" icon="📋" />
          <StatCard label="Prediction Error %" value={current.mean_absolute_error_pct} accent="#FF6B6B" icon="📉" />
          <StatCard label="Over-Estimation Rate %" value={current.over_prediction_rate_pct} accent="#F59E0B" icon="📈" />
          <StatCard label="Past Experience Accuracy %" value={current.memory_adjustment_accuracy_rate_pct} accent="#2DD4BF" icon="🧠" />
        </div>
        <ChartCard title="Predicted vs Actual Demand Shift" accent="var(--success)" height={320} subtitle="Points near the blue line mean the AI predicted the real outcome closely">
          <ScatterChart><CartesianGrid stroke="rgba(255,255,255,0.08)" /><XAxis type="number" dataKey="predicted_demand_shift_pct" name="Predicted" tick={{ fontSize: 11, fill: 'var(--text-dim)' }} /><YAxis type="number" dataKey="actual_demand_shift_pct" name="Actual" tick={{ fontSize: 11, fill: 'var(--text-dim)' }} /><Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={tooltipStyle} /><ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke="#60A5FA" /><Scatter data={scatterData}>{scatterData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}</Scatter></ScatterChart>
        </ChartCard>
        <ReportTable exportName="r09-forecast-accuracy.csv" rows={current.forecast_accuracy || []} columns={[
          { key: 'memory_id', label: 'Memory ID' },
          { key: 'event_type', label: 'Event Type' },
          { key: 'geography', label: 'Geography' },
          { key: 'predicted_demand_shift_pct', label: 'Predicted %' },
          { key: 'actual_demand_shift_pct', label: 'Actual %' },
          { key: 'absolute_error_pct', label: 'Absolute Error %' },
        ]} />
      </>
    )
  }, [activeTab, current, filters, suppliers])

  const allTabs = [...DATASET_TABS, ...PERF_TABS]
  const activeLabel = (allTabs.find(([id]) => id === activeTab) || [])[1]

  return (
    <div style={{ maxWidth: 1700, margin: '0 auto', width: '100%', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header Section */}
      <div className="panel" style={{
        background: 'linear-gradient(135deg, rgba(124,107,255,0.1) 0%, rgba(45,212,191,0.05) 100%)',
        border: '1px solid rgba(124,107,255,0.2)',
        borderRadius: 16,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '32px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-pri)', marginBottom: 4 }}>Reports &amp; Analytics</div>
            <div style={{ fontSize: 14, color: 'var(--text-sec)', lineHeight: 1.6, maxWidth: 560 }}>
              Comprehensive insights from your own data and how the AI performed on your disruption events. Everything is filtered to show only your information — no demo data.
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            <button className="btn btn-sm btn-primary" onClick={loadReport} disabled={isRefreshing || activeTab === 'sb'} style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
            }}>
              {isRefreshing ? '↻' : '↻'} {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <Tag color="var(--success)" style={{ fontSize: 12, fontWeight: 600 }}>Live · your data only</Tag>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Dataset Tabs */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, fontWeight: 700 }}>📊 From Your Dataset</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {DATASET_TABS.map(([id, label]) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                style={{
                  padding: '10px 16px',
                  borderRadius: 10,
                  background: activeTab === id
                    ? 'linear-gradient(135deg, var(--primary), #2dd4bf)'
                    : 'rgba(255,255,255,0.06)',
                  border: activeTab === id
                    ? '1px solid rgba(124,107,255,0.5)'
                    : '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--text-pri)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  boxShadow: activeTab === id ? '0 4px 16px rgba(124,107,255,0.3)' : 'none',
                }}
                onMouseOver={(e) => {
                  if (activeTab !== id) {
                    e.target.style.background = 'rgba(255,255,255,0.1)'
                    e.target.style.borderColor = 'rgba(255,255,255,0.2)'
                  }
                }}
                onMouseOut={(e) => {
                  if (activeTab !== id) {
                    e.target.style.background = 'rgba(255,255,255,0.06)'
                    e.target.style.borderColor = 'rgba(255,255,255,0.1)'
                  }
                }}
              >
                {TAB_ICONS[id]} {label}
              </button>
            ))}
          </div>
        </div>

        {/* Performance Tabs */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, fontWeight: 700 }}>⚙️ AI Performance &amp; Event History</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
            {PERF_TABS.map(([id, label]) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: activeTab === id
                    ? 'linear-gradient(135deg, var(--primary), #2dd4bf)'
                    : 'rgba(255,255,255,0.06)',
                  border: activeTab === id
                    ? '1px solid rgba(124,107,255,0.5)'
                    : '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--text-pri)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  boxShadow: activeTab === id ? '0 4px 16px rgba(124,107,255,0.3)' : 'none',
                  textAlign: 'center',
                }}
                onMouseOver={(e) => {
                  if (activeTab !== id) {
                    e.target.style.background = 'rgba(255,255,255,0.1)'
                    e.target.style.borderColor = 'rgba(255,255,255,0.2)'
                  }
                }}
                onMouseOut={(e) => {
                  if (activeTab !== id) {
                    e.target.style.background = 'rgba(255,255,255,0.06)'
                    e.target.style.borderColor = 'rgba(255,255,255,0.1)'
                  }
                }}
              >
                {TAB_ICONS[id]} {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab Description */}
      {TAB_EXPLAIN[activeTab] && (
        <div style={{
          padding: '14px 18px',
          borderRadius: 12,
          background: 'linear-gradient(135deg, rgba(124,107,255,0.08), rgba(45,212,191,0.04))',
          border: '1px solid rgba(124,107,255,0.25)',
          fontSize: 13,
          color: 'var(--text-sec)',
          lineHeight: 1.6,
          animation: 'slideIn 0.3s ease-out',
        }}>
          <strong style={{ color: 'var(--primary)' }}>{activeLabel}</strong> — {TAB_EXPLAIN[activeTab]}
        </div>
      )}

      {/* Content Area */}
      <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
        {content}
      </div>
    </div>
  )
}
