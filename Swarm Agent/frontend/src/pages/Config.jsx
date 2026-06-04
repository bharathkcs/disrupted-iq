import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../services/api.js'
import { Tag, InfoTooltip } from '../components/ui.jsx'
import AutoMonitorCard from '../components/AutoMonitorCard.jsx'

const THRESHOLD_META = [
  {
    id: 'severity_threshold',
    key: 'severity',
    label: 'Alert Sensitivity',
    unit: '/ 10',
    description: 'Minimum severity score before the AI activates a full response. Set it lower to catch smaller disruptions early; higher to focus only on major events.',
    tip: 'Recommended: 4 — catches most meaningful disruptions without noise.',
  },
  {
    id: 'cascade_window_hours',
    key: 'cascade_window_hours',
    label: 'Cascade Detection Window',
    unit: 'hours',
    description: 'If two disruptions happen within this time window and affect the same suppliers, the AI treats them as one compounding event with higher severity.',
    tip: 'Recommended: 48 — covers a 2-day window typical for spreading disruptions.',
  },
  {
    id: 'dissent_divergence_threshold',
    key: 'dissent_divergence',
    label: 'Expert Agreement Gap',
    unit: 'points',
    description: 'If the AI\'s risk score and recommendation score differ by this many points, you\'ll be asked to review before the plan is confirmed.',
    tip: 'Recommended: 15 — flags meaningful disagreements without over-interrupting.',
  },
  {
    id: 'cascade_overlap_multiplier',
    key: 'cascade_overlap_multiplier',
    label: 'Cascade Severity Boost',
    unit: '× multiplier',
    description: 'How much more serious a compounding (cascade) event is rated compared to a single disruption affecting the same suppliers.',
    tip: 'Recommended: 1.2 — a 20% uplift when events compound.',
  },
  {
    id: 'simulation_sla_seconds',
    key: 'simulation_sla_seconds',
    label: 'Simulation Time Limit',
    unit: 'seconds',
    description: 'Maximum time the AI is allowed to run outcome simulations. If it exceeds this, it falls back to pre-built scenario estimates.',
    tip: 'Recommended: 30 — keeps the pipeline under 90 seconds total.',
  },
]

const POLLING_META = [
  {
    id: 'newsapi_poll_interval_minutes',
    key: 'newsapi_poll_interval_minutes',
    label: 'News Check Frequency',
    unit: 'minutes',
    description: 'How often DisruptIQ checks for new disruption news from global sources.',
    tip: 'Lower = more up-to-date alerts, but uses more API quota.',
  },
  {
    id: 'openmeteo_poll_interval_minutes',
    key: 'openmeteo_poll_interval_minutes',
    label: 'Weather Check Frequency',
    unit: 'minutes',
    description: 'How often the platform refreshes weather data for your supplier zones.',
    tip: 'Weather changes slowly — 60 minutes is usually sufficient.',
  },
  {
    id: 'minimum_severity_to_alert',
    key: 'minimum_severity_to_alert',
    label: 'Minimum Severity to Notify',
    unit: '/ 10',
    description: 'Disruptions below this severity score are monitored silently. Only events at or above this level trigger a notification to you.',
    tip: 'Set this at or above your Alert Sensitivity to avoid notification noise.',
  },
]

const fieldVal = (id) => Number(document.getElementById(id)?.value || 0)

export default function ConfigPage() {
  const [cfg, setCfg] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [memory, setMemory] = useState([])
  const [history, setHistory] = useState([])
  const [editing, setEditing] = useState(null)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [savingThresholds, setSavingThresholds] = useState(false)
  const [savingPolling, setSavingPolling] = useState(false)
  const [saveMsg, setSaveMsg] = useState({})

  const [xlsxUploadFile, setXlsxUploadFile] = useState(null)
  const [xlsxUploading, setXlsxUploading] = useState(false)
  const [xlsxResult, setXlsxResult] = useState(null)
  const [xlsxErrors, setXlsxErrors] = useState([])
  const [downloadingTemplate, setDownloadingTemplate] = useState(false)

  const isDemoMode = typeof window !== 'undefined' && window.location.pathname.startsWith('/demo')
  const [showDemoLock, setShowDemoLock] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const load = async () => {
    try {
      setIsRefreshing(true)
      const [configData, supplierData, memoryData, configHistory, audit] = await Promise.all([api.config(), api.suppliers(), api.memory(), api.configHistory(), api.auditLog()])
      setCfg(configData)
      const suppliersArray = Array.isArray(supplierData) ? supplierData : (supplierData?.suppliers || [])
      setSuppliers(suppliersArray)
      const memoryArray = Array.isArray(memoryData) ? memoryData : (memoryData?.records || [])
      setMemory(memoryArray || [])
      setHistory([
        ...(configHistory || []),
        ...(audit || []).filter(e => (e.action || '').includes('config') || e.agent === 'Config'),
      ])
    } catch (err) {
      console.error('Config load error:', err)
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    let alive = true
    load()
    const t = setInterval(() => { if (alive) load() }, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const oldestRecord = useMemo(() => {
    const ordered = [...memory].sort((a, b) => (a.timestamp_utc || '').localeCompare(b.timestamp_utc || ''))
    const ts = ordered[0]?.timestamp_utc
    if (!ts) return null
    try { return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
    catch { return ts }
  }, [memory])

  if (!cfg) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
        <div className="panel panel-pad"><span className="mono c-dim">Loading configuration…</span></div>
      </div>
    )
  }

  const showSave = (section, ok) => {
    setSaveMsg(prev => ({ ...prev, [section]: ok ? '✓ Saved' : '✗ Save failed' }))
    setTimeout(() => setSaveMsg(prev => { const n = { ...prev }; delete n[section]; return n }), 3000)
  }

  const saveThresholds = async () => {
    setSavingThresholds(true)
    try {
      await api.updateConfig({
        section: 'thresholds',
        values: {
          severity_escalation_threshold: fieldVal('severity_threshold'),
          cascade_detection_window_hours: fieldVal('cascade_window_hours'),
          dissent_divergence_threshold: fieldVal('dissent_divergence_threshold'),
          cascade_overlap_multiplier: fieldVal('cascade_overlap_multiplier'),
          simulation_sla_seconds: fieldVal('simulation_sla_seconds'),
        },
      })
      showSave('thresholds', true)
      load()
    } catch { showSave('thresholds', false) }
    finally { setSavingThresholds(false) }
  }

  const savePolling = async () => {
    setSavingPolling(true)
    try {
      await api.updateConfig({
        section: 'polling',
        values: {
          newsapi_poll_interval_minutes: fieldVal('newsapi_poll_interval_minutes'),
          openmeteo_poll_interval_minutes: fieldVal('openmeteo_poll_interval_minutes'),
          minimum_severity_to_alert: fieldVal('minimum_severity_to_alert'),
        },
      })
      showSave('polling', true)
      load()
    } catch { showSave('polling', false) }
    finally { setSavingPolling(false) }
  }

  const exportMemory = () => {
    const blob = new Blob([JSON.stringify(memory, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'ai-learning-history.json'; a.click()
    URL.revokeObjectURL(url)
  }

  const downloadTemplate = async () => {
    setDownloadingTemplate(true)
    try {
      const blob = await api.downloadSupplierTemplate()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'disruptiq_supplier_template.xlsx'; a.click()
      URL.revokeObjectURL(url)
    } catch (err) { setXlsxErrors(['Failed to download template: ' + err.message]) }
    finally { setDownloadingTemplate(false) }
  }

  const handleXlsxUpload = async () => {
    if (!xlsxUploadFile) return
    setXlsxUploading(true); setXlsxResult(null); setXlsxErrors([])
    try {
      const res = await api.uploadSupplierExcel(xlsxUploadFile)
      setXlsxResult(res); setXlsxErrors(res.errors || [])
      setXlsxUploadFile(null); load()
    } catch (err) { setXlsxErrors([err.message]) }
    finally { setXlsxUploading(false) }
  }

  const stage1 = memory.filter(r => r.stage === 1).length
  const stage2 = memory.filter(r => r.stage === 2).length

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', width: '100%', padding: '16px 16px 40px', display: 'flex', flexDirection: 'column', gap: 20, position: 'relative' }}>

      {/* Demo mode: lock modal */}
      {isDemoMode && showDemoLock && (
        <div
          onClick={() => setShowDemoLock(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: 460, width: '100%', background: 'rgba(10,13,32,0.98)', border: '1px solid rgba(124,107,255,0.4)', borderRadius: 18, padding: '36px 32px', textAlign: 'center', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}
          >
            <div style={{ fontSize: 42, marginBottom: 14 }}>🔒</div>
            <div style={{ fontSize: 21, fontWeight: 800, color: '#f1f5f9', marginBottom: 10, letterSpacing: '-0.01em' }}>
              Configuration Locked
            </div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.52)', lineHeight: 1.7, marginBottom: 28 }}>
              You're exploring in demo mode. To set your own alert thresholds, manage suppliers, and configure your live supply-chain intelligence — register a free account and onboard your data in minutes.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <a
                href="/signup-register"
                style={{ display: 'block', padding: '13px 20px', borderRadius: 11, background: 'linear-gradient(135deg, #7c6bff, #6366f1)', color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none', boxShadow: '0 4px 20px rgba(124,107,255,0.45)' }}
              >
                Create Free Account →
              </a>
              <button
                onClick={() => setShowDemoLock(false)}
                style={{ padding: '11px 20px', borderRadius: 11, background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.4)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
              >
                Continue Exploring Demo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page header */}
      <div className="panel" style={{
        background: 'linear-gradient(135deg, rgba(124,107,255,0.1) 0%, rgba(45,212,191,0.05) 100%)',
        border: '1px solid rgba(124,107,255,0.2)',
        borderRadius: 16,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '32px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-pri)', marginBottom: 4 }}>System Configuration</div>
            <div style={{ color: 'var(--text-sec)', lineHeight: 1.6, maxWidth: 560, fontSize: 14 }}>
              Control alert sensitivity, monitor your suppliers, and manage how the AI learns from disruptions. Changes take effect immediately.
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={load} disabled={isRefreshing} style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            whiteSpace: 'nowrap',
          }}>
            {isRefreshing ? '↻' : '↻'} {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div style={{ padding: '0 28px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          {[
            { label: 'Alert Sensitivity', value: cfg.thresholds?.severity ?? '—', sub: 'Minimum score to activate', icon: '⚡' },
            { label: 'Suppliers Monitored', value: suppliers.length, sub: 'Currently tracked', icon: '📦' },
            { label: 'Learning Records', value: memory.length, sub: 'Predictions + outcomes', icon: '🧠' },
          ].map(s => (
            <div key={s.label} style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              padding: '16px 14px',
              transition: 'all 0.3s ease',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'rgba(124,107,255,0.08)'
              e.currentTarget.style.borderColor = 'rgba(124,107,255,0.3)'
              e.currentTarget.style.transform = 'translateY(-2px)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>{s.icon}</span>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--primary)' }}>{s.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{s.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Alert & Response Sensitivity */}
      <div className="panel">
        <div style={{
          padding: '24px 28px',
          background: 'linear-gradient(135deg, rgba(124,107,255,0.08), rgba(96,165,250,0.04))',
          borderBottom: '1px solid rgba(124,107,255,0.2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 20 }}>⚙️</span>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-pri)' }}>Alert &amp; Response Sensitivity</div>
              <div style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 3 }}>
                Control when DisruptIQ activates, how it scores disruptions, and when you step in.
              </div>
            </div>
          </div>
        </div>
        <div style={{ padding: '18px 28px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
            {THRESHOLD_META.map(m => (
              <div key={m.id} style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 14,
                padding: '16px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                transition: 'all 0.3s ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(124,107,255,0.1)'
                e.currentTarget.style.borderColor = 'rgba(124,107,255,0.3)'
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
              }}
              >
                <div style={{ fontWeight: 700, color: 'var(--text-pri)', fontSize: 14 }}>{m.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.5 }}>{m.description}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                  <input
                    id={m.id}
                    type="number"
                    defaultValue={cfg.thresholds?.[m.key]}
                    style={{
                      flex: 1,
                      maxWidth: 90,
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(124,107,255,0.3)',
                      color: 'var(--text-pri)',
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-dim)', minWidth: 40 }}>{m.unit}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 500, lineHeight: 1.4 }}>💡 {m.tip}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-primary" onClick={saveThresholds} disabled={savingThresholds}>
              {savingThresholds ? '⏳ Saving…' : '💾 Save Sensitivity Settings'}
            </button>
            {saveMsg.thresholds && <span style={{ fontSize: 13, color: saveMsg.thresholds.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>{saveMsg.thresholds}</span>}
          </div>
        </div>
      </div>

      {/* Auto-Monitoring (Sprint Section 1) */}
      <AutoMonitorCard />

      {/* Data Refresh Schedule */}
      <div className="panel">
        <div style={{
          padding: '24px 28px',
          background: 'linear-gradient(135deg, rgba(45,212,191,0.08), rgba(96,165,250,0.04))',
          borderBottom: '1px solid rgba(45,212,191,0.2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 20 }}>📡</span>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-pri)' }}>Data Refresh Schedule</div>
              <div style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 3 }}>
                How frequently DisruptIQ checks news and weather data for your supplier zones.
              </div>
            </div>
          </div>
        </div>
        <div style={{ padding: '18px 28px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
            {POLLING_META.map(m => (
              <div key={m.id} style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 14,
                padding: '16px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                transition: 'all 0.3s ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(45,212,191,0.1)'
                e.currentTarget.style.borderColor = 'rgba(45,212,191,0.3)'
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
              }}
              >
                <div style={{ fontWeight: 700, color: 'var(--text-pri)', fontSize: 14 }}>{m.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.5 }}>{m.description}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                  <input
                    id={m.id}
                    type="number"
                    defaultValue={m.key === 'minimum_severity_to_alert' ? cfg.thresholds?.[m.key] : cfg.polling?.[m.key]}
                    style={{
                      flex: 1,
                      maxWidth: 90,
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(45,212,191,0.3)',
                      color: 'var(--text-pri)',
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-dim)', minWidth: 40 }}>{m.unit}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--success)', fontWeight: 500, lineHeight: 1.4 }}>💡 {m.tip}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-primary" onClick={savePolling} disabled={savingPolling}>
              {savingPolling ? '⏳ Saving…' : '💾 Save Refresh Schedule'}
            </button>
            {saveMsg.polling && <span style={{ fontSize: 13, color: saveMsg.polling.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>{saveMsg.polling}</span>}
          </div>
        </div>
      </div>

      {/* Supplier List */}
      <div className="panel">
        <div className="panel-header">
          <span className="label">Your Supplier List</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Tag color="var(--info)">{suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''}</Tag>
            <InfoTooltip title="Your Supplier Network" description="Every risk score, forecast, and recovery recommendation the AI generates is built from this list. Keep supplier details — zone, buffer stock, reliability, and categories — accurate for the best results." />
          </div>
        </div>
        <div style={{ padding: '12px 18px 4px', color: 'var(--text-dim)', fontSize: 13 }}>
          Every risk score, forecast, and recovery recommendation is built from this list. Keep supplier details accurate for the best AI output.
          Click <strong>Edit</strong> on any row to correct a value.
        </div>
        {suppliers.length === 0 ? (
          <div style={{ padding: '24px 18px', color: 'var(--text-dim)', fontSize: 13, textAlign: 'center' }}>
            No suppliers added yet. Use the <strong>Add Suppliers via Excel</strong> section below to upload your list.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Supplier Name</th>
                  <th>Region / Zone</th>
                  <th>Buffer Stock (days)</th>
                  <th>Production Sites</th>
                  <th>Reliability (%)</th>
                  <th>Proximity Score</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map(supplier => {
                  const isEditing = editing?.id === supplier.id
                  const current = isEditing ? editing : supplier
                  return (
                    <tr key={supplier.id}>
                      <td>{isEditing ? <input value={current.name} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} /> : supplier.name}</td>
                      <td>{isEditing ? <input value={current.zone} onChange={e => setEditing(p => ({ ...p, zone: e.target.value }))} /> : supplier.zone}</td>
                      <td>{isEditing ? <input type="number" value={current.buffer_stock_days} onChange={e => setEditing(p => ({ ...p, buffer_stock_days: Number(e.target.value) }))} /> : supplier.buffer_stock_days}</td>
                      <td>{isEditing ? <input type="number" value={current.sites} onChange={e => setEditing(p => ({ ...p, sites: Number(e.target.value) }))} /> : supplier.sites}</td>
                      <td>{isEditing ? <input type="number" value={current.reliability} onChange={e => setEditing(p => ({ ...p, reliability: Number(e.target.value) }))} /> : `${supplier.reliability}%`}</td>
                      <td>{isEditing ? <input type="number" value={current.proximity_score} onChange={e => setEditing(p => ({ ...p, proximity_score: Number(e.target.value) }))} /> : supplier.proximity_score}</td>
                      <td>
                        {isEditing ? (
                          <button className="btn btn-sm btn-primary" onClick={async () => {
                            await api.updateSupplier({ supplier_id: supplier.id, updates: { name: editing.name, zone: editing.zone, buffer_stock_days: editing.buffer_stock_days, sites: editing.sites, reliability: editing.reliability, proximity_score: editing.proximity_score } })
                            setEditing(null); load()
                          }}>Save</button>
                        ) : (
                          <button className="btn btn-sm btn-ghost" onClick={() => setEditing({ ...supplier })}>Edit</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Supplier Onboarding */}
      <div className="panel">
        <div className="panel-header">
          <span className="label">Add Suppliers via Excel</span>
          <Tag color="var(--accent)">Bulk import</Tag>
        </div>
        <div style={{ padding: '4px 18px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ color: 'var(--text-dim)', fontSize: 13, paddingTop: 8 }}>
            The fastest way to add your full supplier list. Download the template, fill in your data, and upload it back.
            Up to 30 suppliers are supported on the free plan.
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontWeight: 600, color: 'var(--text-pri)', marginBottom: 6 }}>Step 1 — Download the Template</div>
            <div style={{ fontSize: 12, color: 'var(--text-sec)', marginBottom: 10 }}>
              The template includes column headers and example rows so you know exactly what format is required.
            </div>
            <button className="btn btn-ghost btn-sm" onClick={downloadTemplate} disabled={downloadingTemplate}>
              {downloadingTemplate ? 'Downloading…' : '⬇ Download Excel Template (.xlsx)'}
            </button>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontWeight: 600, color: 'var(--text-pri)', marginBottom: 6 }}>Step 2 — Upload Your Filled Template</div>
            <div style={{ fontSize: 12, color: 'var(--text-sec)', marginBottom: 10 }}>
              Required columns: <strong>Supplier Name</strong> and <strong>Zone</strong>. All other fields improve accuracy but are optional.
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', background: 'rgba(255,255,255,0.07)', border: '1px solid var(--glass-border-bright)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 13, color: 'var(--text-sec)' }}>
                {xlsxUploadFile ? `📄 ${xlsxUploadFile.name}` : '📁 Choose Excel file…'}
                <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { setXlsxUploadFile(e.target.files?.[0] || null); setXlsxResult(null) }} />
              </label>
              <button className="btn btn-primary btn-sm" onClick={handleXlsxUpload} disabled={!xlsxUploadFile || xlsxUploading}>
                {xlsxUploading ? 'Uploading…' : 'Upload Suppliers'}
              </button>
            </div>
          </div>

          {xlsxResult && xlsxResult.suppliers_added > 0 && (
            <div style={{ background: 'rgba(45,212,191,0.08)', border: '1px solid rgba(45,212,191,0.3)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ color: 'var(--success)', fontWeight: 600, marginBottom: xlsxResult.limit_reached ? 6 : 0 }}>
                ✓ {xlsxResult.suppliers_added} supplier{xlsxResult.suppliers_added !== 1 ? 's' : ''} imported successfully.
                {' '}You now have {xlsxResult.total_suppliers} supplier{xlsxResult.total_suppliers !== 1 ? 's' : ''}.
              </div>
              {xlsxResult.limit_reached && (
                <div style={{ fontSize: 12, color: 'var(--warning)' }}>
                  ⚠ Some rows were skipped — you have reached the 30-supplier free-plan limit.
                  To import more, request Premium access in your Account Settings.
                </div>
              )}
            </div>
          )}
          {xlsxResult && xlsxResult.suppliers_added === 0 && (
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ color: 'var(--warning)', fontWeight: 600, marginBottom: 4 }}>⚠ No new suppliers were imported</div>
              <div style={{ fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.6 }}>
                {xlsxResult.message || 'You may have reached the 30-supplier free-plan limit. Request Premium in Account Settings to add more.'}
              </div>
            </div>
          )}

          {xlsxErrors.length > 0 && (
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontWeight: 600, color: 'var(--warning)', marginBottom: 6 }}>Warnings</div>
              {xlsxErrors.map((err, i) => (
                <div key={i} className="mono c-dim" style={{ fontSize: 11, marginTop: 4 }}>{err}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* AI Learning History */}
      <div className="panel panel-pad">
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-pri)' }}>AI Learning History</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 4, maxWidth: 680, lineHeight: 1.6 }}>
            Every time the AI analyses a disruption, it saves a <strong>prediction record</strong>.
            When you mark an event as resolved, it saves a <strong>confirmed outcome</strong>.
            Future predictions for similar disruptions are automatically calibrated against these outcomes — the AI gets smarter over time.
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          {[
            { label: 'Total Records', value: memory.length, sub: 'Predictions + outcomes combined' },
            { label: 'Predictions Made', value: stage1, sub: 'What the AI forecast before events resolved' },
            { label: 'Confirmed Outcomes', value: stage2, sub: 'What actually happened — used for calibration' },
            { label: 'Oldest Record', value: oldestRecord || '—', sub: 'Date of first learning entry' },
          ].map(s => (
            <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>{s.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{s.sub}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={() => setMemoryOpen(o => !o)}>
            {memoryOpen ? 'Hide Raw Records' : 'View Raw Records'}
          </button>
          <button className="btn btn-primary" onClick={exportMemory}>Export as JSON</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>
          Records are permanent and cannot be edited — this ensures the AI's learning history remains trustworthy.
        </div>
        {memoryOpen && (
          <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 10, fontSize: 11 }}>
            {JSON.stringify(memory, null, 2)}
          </pre>
        )}
      </div>

      {/* Configuration Change Log */}
      <div className="panel">
        <div className="panel-header">
          <span className="label">Settings Change History</span>
        </div>
        <div style={{ padding: '8px 18px 4px', color: 'var(--text-dim)', fontSize: 13 }}>
          A full audit trail of every setting change — what was changed, the old and new values, and when it happened.
        </div>
        {history.length === 0 ? (
          <div style={{ padding: '20px 18px', color: 'var(--text-dim)', fontSize: 13 }}>No configuration changes recorded yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>What Changed</th>
                  <th>Previous Value</th>
                  <th>New Value</th>
                  <th>Changed By</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry, idx) => {
                  const when = entry.timestamp_utc
                    ? (() => { try { return new Date(entry.timestamp_utc).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) } catch { return entry.timestamp_utc } })()
                    : '—'
                  return (
                    <tr key={entry.id || idx}>
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>{when}</td>
                      <td>{entry.action || Object.keys(entry.changes || {}).join(', ') || '—'}</td>
                      <td style={{ color: 'var(--text-dim)' }}>{entry.input_summary || '—'}</td>
                      <td>{entry.output_summary || JSON.stringify(entry.changes || {}) || '—'}</td>
                      <td>{entry.actor || entry.agent || 'Admin'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Click overlay blocker for demo mode */}
      {isDemoMode && (
        <div
          onClick={() => setShowDemoLock(true)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 8999,
            cursor: 'not-allowed',
            pointerEvents: 'auto',
          }}
        />
      )}
    </div>
  )
}
