import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../services/api.js'
import { InfoTooltip } from './ui.jsx'

const LEVEL_STYLE = {
  critical: { color: 'var(--danger)', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.3)', icon: '⚠', tag: 'Action needed' },
  warning: { color: 'var(--warning)', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.28)', icon: '▲', tag: 'Watch' },
  info: { color: 'var(--info)', bg: 'rgba(96,165,250,0.08)', border: 'rgba(96,165,250,0.25)', icon: 'ℹ', tag: 'Note' },
  good: { color: 'var(--success)', bg: 'rgba(45,212,191,0.07)', border: 'rgba(45,212,191,0.22)', icon: '✓', tag: 'Healthy' },
}

const LEVEL_ORDER = { critical: 0, warning: 1, info: 2, good: 3 }
const topNames = (names, n = 3) => names.slice(0, n).join(', ') + (names.length > n ? `, +${names.length - n} more` : '')

/**
 * Builds plain-language, dataset-driven inferences from the client's own suppliers.
 * @param {Array<{name:string, zone:string, buffer_stock_days:number, sites:number, reliability:number, categories:string[]}>} suppliers
 * @returns {Array<{level:string, title:string, body:string, action:string}>}
 */
export function generateInsights(suppliers) {
  if (!Array.isArray(suppliers) || suppliers.length === 0) return []
  const total = suppliers.length
  const insights = []

  // 1. Single-source category risk
  const categoryMap = {}
  suppliers.forEach(s => (s.categories || []).forEach(c => {
    const key = String(c).trim()
    if (!key) return
    if (!categoryMap[key]) categoryMap[key] = []
    categoryMap[key].push(s.name)
  }))
  const singleSource = Object.entries(categoryMap).filter(([, names]) => names.length === 1).map(([cat]) => cat)
  if (singleSource.length > 0) {
    insights.push({
      level: 'critical',
      title: `${singleSource.length} ${singleSource.length === 1 ? 'category relies' : 'categories rely'} on a single supplier`,
      body: `These categories have no backup source: ${topNames(singleSource, 4)}. If that one supplier is disrupted, you lose this capability entirely until you find an alternative.`,
      action: `Identify and qualify a second supplier for ${singleSource.length === 1 ? 'this category' : 'these categories'}, starting with the most business-critical.`,
    })
  }

  // 2. Geographic concentration
  const zoneMap = {}
  suppliers.forEach(s => { const z = s.zone || 'Unknown'; zoneMap[z] = (zoneMap[z] || 0) + 1 })
  const [topZone, topCount] = Object.entries(zoneMap).sort((a, b) => b[1] - a[1])[0] || ['', 0]
  const zonePct = Math.round((topCount / total) * 100)
  if (total >= 3 && zonePct >= 40) {
    insights.push({
      level: zonePct >= 60 ? 'warning' : 'info',
      title: `${zonePct}% of your suppliers are concentrated in ${topZone}`,
      body: `${topCount} of your ${total} suppliers operate in ${topZone}. A single regional event there — flood, strike, power outage, or port closure — could disrupt most of your supply base at once.`,
      action: `Where possible, source some categories from suppliers in other regions to spread geographic risk.`,
    })
  }

  // 3. Buffer stock
  const lowBuffer = suppliers.filter(s => (s.buffer_stock_days || 0) < 14)
  const critBuffer = lowBuffer.filter(s => (s.buffer_stock_days || 0) < 7)
  if (lowBuffer.length > 0) {
    insights.push({
      level: critBuffer.length > 0 ? 'warning' : 'info',
      title: `${lowBuffer.length} ${lowBuffer.length === 1 ? 'supplier has' : 'suppliers have'} less than 2 weeks of buffer stock`,
      body: critBuffer.length > 0
        ? `${critBuffer.length} of them have under 7 days. Low buffer means very little time to react if that supplier is disrupted before stock runs out.`
        : `Low buffer means a shorter window to react before stock runs out if that supplier is disrupted.`,
      action: `Prioritise raising buffer stock with: ${topNames((critBuffer.length > 0 ? critBuffer : lowBuffer).map(s => s.name))}.`,
    })
  }

  // 4. Reliability
  const lowRel = suppliers.filter(s => (s.reliability || 0) < 85)
  if (lowRel.length > 0) {
    insights.push({
      level: lowRel.some(s => (s.reliability || 0) < 75) ? 'warning' : 'info',
      title: `${lowRel.length} ${lowRel.length === 1 ? 'supplier has' : 'suppliers have'} reliability below 85%`,
      body: `Lower reliability means a higher chance of late or missed deliveries. Affected: ${topNames(lowRel.map(s => `${s.name} (${s.reliability}%)`))}.`,
      action: `Review delivery performance with these suppliers, or line up alternatives for the categories they cover.`,
    })
  }

  // 5. Single-site exposure
  const singleSite = suppliers.filter(s => (s.sites || 1) <= 1)
  if (singleSite.length > 0) {
    insights.push({
      level: 'info',
      title: `${singleSite.length} ${singleSite.length === 1 ? 'supplier operates' : 'suppliers operate'} from a single production site`,
      body: `If that one site goes down — fire, flood, equipment failure — the supplier has no internal backup to keep production running. Affected: ${topNames(singleSite.map(s => s.name))}.`,
      action: `Favour multi-site suppliers for critical categories, or hold extra buffer stock for single-site ones.`,
    })
  }

  // 6. Per-category buffer benchmark (uses ONLY this client's own dataset — no external median).
  // For each category we compute the median buffer across the client's suppliers in that
  // category and surface the categories where the average lags the median by 3+ days.
  const categoryBufferLag = []
  Object.entries(categoryMap).forEach(([cat, names]) => {
    const subSuppliers = suppliers.filter(s => (s.categories || []).map(String).map(c => c.trim()).includes(cat))
    if (subSuppliers.length < 2) return
    const buffers = subSuppliers.map(s => s.buffer_stock_days || 0).sort((a, b) => a - b)
    const median = buffers[Math.floor(buffers.length / 2)]
    const avg = buffers.reduce((sum, b) => sum + b, 0) / buffers.length
    if (median - avg >= 3) {
      categoryBufferLag.push({ cat, median, avg: Math.round(avg) })
    }
  })
  if (categoryBufferLag.length > 0) {
    const top = categoryBufferLag.slice(0, 3)
    insights.push({
      level: 'info',
      title: `Buffer-stock benchmark: ${categoryBufferLag.length} ${categoryBufferLag.length === 1 ? 'category lags' : 'categories lag'} the rest of your supply base`,
      body: `Comparing each category to your own dataset's median buffer: ${top.map(c => `${c.cat} ${c.avg}d vs ${c.median}d median`).join(' · ')}.`,
      action: `Increase buffer for the laggards or rotate orders to the higher-buffer suppliers in the same category.`,
    })
  }

  // 7. Positive note when no material risks surfaced
  if (insights.length === 0) {
    insights.push({
      level: 'good',
      title: 'Your supply base looks well-diversified',
      body: 'No single-source categories, no severe regional concentration, and healthy buffer and reliability across your suppliers.',
      action: 'Keep monitoring — these insights refresh automatically whenever you add or remove suppliers.',
    })
  }

  return insights.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
}

/**
 * @param {{ suppliers?: Array, title?: string, intro?: string }} props
 */
export default function InsightsPanel({ suppliers: suppliersProp, title = 'Automated Insights', intro }) {
  const [fetched, setFetched] = useState(null)
  const [loading, setLoading] = useState(!suppliersProp)

  useEffect(() => {
    if (suppliersProp) return
    let alive = true
    api.suppliers()
      .then(res => {
        if (!alive) return
        setFetched(Array.isArray(res) ? res : (res?.suppliers || []))
      })
      .catch(() => { if (alive) setFetched([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [suppliersProp])

  const suppliers = suppliersProp || fetched || []
  const insights = useMemo(() => generateInsights(suppliers), [suppliers])

  return (
    <div className="panel panel-pad">
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>🧠</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-pri)' }}>{title}</span>
          <InfoTooltip
            title="Portfolio Intelligence"
            description="Algorithmic analysis of your uploaded supplier data — no AI calls needed. Surfaces structural risks such as single-source categories, geographic concentration, low-buffer zones, and reliability outliers, each with a recommended action."
          />
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4, maxWidth: 720, lineHeight: 1.6 }}>
          {intro || 'Generated automatically from your own supplier data. These are the risks and patterns the system spotted in your supply base — and what we suggest doing about each one.'}
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>Analysing your supplier data…</div>
      ) : suppliers.length === 0 ? (
        <div style={{ padding: '16px 18px', borderRadius: 10, background: 'rgba(124,107,255,0.07)', border: '1px solid rgba(124,107,255,0.2)', color: 'var(--text-sec)', fontSize: 13, lineHeight: 1.6 }}>
          No suppliers added yet, so there's nothing to analyse. Once you upload your supplier list, this panel will automatically surface your biggest concentration, buffer, and reliability risks — with a recommended action for each.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {insights.map((ins, i) => {
            const st = LEVEL_STYLE[ins.level] || LEVEL_STYLE.info
            return (
              <div key={i} style={{ background: st.bg, border: `1px solid ${st.border}`, borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: 'var(--text-pri)', fontSize: 14, lineHeight: 1.35 }}>
                    <span style={{ color: st.color }}>{st.icon}</span>
                    <span>{ins.title}</span>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: st.color, background: 'rgba(255,255,255,0.04)', border: `1px solid ${st.border}`, borderRadius: 20, padding: '2px 9px' }}>{st.tag}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-sec)', lineHeight: 1.55 }}>{ins.body}</div>
                <div style={{ fontSize: 12.5, color: st.color, lineHeight: 1.5, marginTop: 2 }}>
                  <strong>What to do:</strong> {ins.action}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
