import React, { useEffect, useState, useRef, useCallback } from 'react'
import { api } from '../services/api.js'

const INDUSTRY_ICONS = {
  'Automotive': '🚗', 'Electronics': '💡', 'Pharmaceutical': '💊',
  'FMCG': '🛒', 'Aerospace': '✈️', 'Renewable Energy': '🌱',
  'Food & Beverage': '🍎', 'Chemicals': '⚗️', 'Logistics / 3PL': '🚚',
  'Medical Devices': '🩺',
}

function SampleDatasetModal({ onClose }) {
  const [datasets, setDatasets] = useState(null)
  const [downloading, setDownloading] = useState(null)
  const [dlError, setDlError] = useState(null)

  useEffect(() => {
    api.sampleDatasets()
      .then(res => setDatasets(res.datasets || []))
      .catch(() => setDlError('Could not load sample datasets. Please try again.'))
  }, [])

  const handleDownload = useCallback(async (ds) => {
    setDownloading(ds.filename)
    setDlError(null)
    try {
      const blob = await api.downloadSampleDataset(ds.filename)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = ds.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setDlError(`Download failed for "${ds.filename}". Please try again.`)
    } finally {
      setDownloading(null)
    }
  }, [])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#111827', border: '1px solid rgba(124,107,255,0.3)',
        borderRadius: 16, width: '100%', maxWidth: 760,
        maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 22px', borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 4 }}>
              Sample Supplier Datasets
            </div>
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
              Download any dataset below, then upload it to your account to explore the full DisruptIQ experience — no proprietary data required.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              flexShrink: 0, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.5)', borderRadius: 8, width: 32, height: 32,
              cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '16px 22px', flex: 1 }}>
          {dlError && (
            <div style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)',
              color: '#fca5a5', padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 12.5,
            }}>⚠️ {dlError}</div>
          )}
          {!datasets && !dlError && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>
              Loading datasets…
            </div>
          )}
          {datasets && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
              {datasets.map(ds => {
                const icon = INDUSTRY_ICONS[ds.industry] || '📦'
                const isBusy = downloading === ds.filename
                return (
                  <div key={ds.id} style={{
                    background: 'rgba(124,107,255,0.05)', border: '1px solid rgba(124,107,255,0.18)',
                    borderRadius: 12, padding: '14px 16px',
                    display: 'flex', flexDirection: 'column', gap: 10,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{
                        width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                        background: 'rgba(124,107,255,0.14)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
                      }}>{icon}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#e8e8ff' }}>{ds.industry}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 10.5, color: '#2dd4bf', background: 'rgba(45,212,191,0.1)', padding: '1px 7px', borderRadius: 10, fontWeight: 600 }}>{ds.geography}</span>
                          <span style={{ fontSize: 10.5, color: '#a78bfa', background: 'rgba(167,139,250,0.1)', padding: '1px 7px', borderRadius: 10, fontWeight: 600 }}>{ds.supplier_count} suppliers</span>
                        </div>
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: 11.5, color: 'rgba(255,255,255,0.42)', lineHeight: 1.55 }}>
                      {ds.description}
                    </p>
                    <button
                      onClick={() => handleDownload(ds)}
                      disabled={!!downloading}
                      style={{
                        marginTop: 2, padding: '8px 0', borderRadius: 8, border: 'none',
                        cursor: downloading ? 'not-allowed' : 'pointer',
                        background: isBusy
                          ? 'rgba(124,107,255,0.25)'
                          : 'linear-gradient(90deg, #7c6bff, #2dd4bf)',
                        color: '#fff', fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
                        opacity: downloading && !isBusy ? 0.45 : 1,
                        transition: 'opacity 0.2s',
                      }}
                    >
                      {isBusy ? 'Downloading…' : '⬇  Download Dataset'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: '12px 22px', borderTop: '1px solid rgba(255,255,255,0.07)',
          fontSize: 11, color: 'rgba(255,255,255,0.28)', lineHeight: 1.5,
        }}>
          These datasets are provided for evaluation purposes only. After downloading, upload via the{' '}
          <strong style={{ color: 'rgba(255,255,255,0.45)' }}>Upload Suppliers</strong> button on your dashboard.
        </div>
      </div>
    </div>
  )
}

const DISMISS_KEY = 'disruptiq_onboarding_done'

const STEP_META = {
  account_created:    { icon: '🔐', color: '#7c6bff' },
  suppliers_imported: { icon: '🏭', color: '#2dd4bf' },
  first_scenario:     { icon: '🚀', color: '#60a5fa' },
  view_map:           { icon: '🗺️', color: '#f59e0b' },
  resilience_score:   { icon: '📊', color: '#10b981' },
  resolve_disruption: { icon: '✅', color: '#f472b6' },
}

function AnimatedRing({ pct, color, size = 88 }) {
  const r = (size - 10) / 2
  const circ = 2 * Math.PI * r
  const [animated, setAnimated] = useState(0)
  const raf = useRef(null)

  useEffect(() => {
    let start = null
    const from = 0
    const duration = 900
    const step = (ts) => {
      if (!start) start = ts
      const p = Math.min((ts - start) / duration, 1)
      const ease = 1 - Math.pow(1 - p, 3)
      setAnimated(from + (pct - from) * ease)
      if (p < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [pct])

  const dash = (animated / 100) * circ

  return (
    <svg width={size} height={size} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="ob-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor="#2dd4bf" />
        </linearGradient>
      </defs>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6" />
      <circle
        cx={size/2} cy={size/2} r={r}
        fill="none"
        stroke="url(#ob-ring-grad)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        style={{ transform: 'rotate(-90deg)', transformOrigin: `${size/2}px ${size/2}px` }}
      />
      <text x={size/2} y={size/2 - 3} textAnchor="middle" fontSize="16" fontWeight="800" fill="#fff">
        {Math.round(animated)}%
      </text>
      <text x={size/2} y={size/2 + 12} textAnchor="middle" fontSize="7.5" fill="rgba(255,255,255,0.4)" fontWeight="600" letterSpacing="1">
        DONE
      </text>
    </svg>
  )
}

export default function OnboardingWidget() {
  const [checklist, setChecklist] = useState(null)
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem(DISMISS_KEY))
  const [exiting, setExiting] = useState(false)
  const [showSampleModal, setShowSampleModal] = useState(false)

  useEffect(() => {
    if (dismissed) return
    api.onboardingChecklist().then(setChecklist).catch(() => {})
  }, [dismissed])

  useEffect(() => {
    if (checklist?.progress_pct === 100) {
      setTimeout(() => {
        setExiting(true)
        setTimeout(() => {
          localStorage.setItem(DISMISS_KEY, '1')
          setDismissed(true)
        }, 600)
      }, 1400)
    }
  }, [checklist?.progress_pct])

  if (dismissed || !checklist) return null

  const pct = checklist.progress_pct || 0
  const done = checklist.steps?.filter(s => s.complete).length || 0
  const total = checklist.steps?.length || 0
  const ringColor = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#7c6bff'

  return (
    <div style={{
      marginBottom: 16,
      borderRadius: 16,
      background: 'linear-gradient(135deg, rgba(124,107,255,0.08) 0%, rgba(45,212,191,0.05) 100%)',
      border: '1px solid rgba(124,107,255,0.22)',
      overflow: 'hidden',
      boxShadow: '0 4px 24px rgba(124,107,255,0.09)',
      opacity: exiting ? 0 : 1,
      transform: exiting ? 'translateY(-10px) scale(0.97)' : 'translateY(0) scale(1)',
      transition: 'opacity 0.5s ease, transform 0.5s ease',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        background: 'rgba(124,107,255,0.07)',
        borderBottom: '1px solid rgba(124,107,255,0.14)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{
            width: 26, height: 26, borderRadius: 7,
            background: 'linear-gradient(135deg, #7c6bff, #2dd4bf)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
          }}>🎯</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>Getting Started</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>
              {done} of {total} steps complete
            </div>
          </div>
        </div>
        <div style={{
          background: `${ringColor}18`, border: `1px solid ${ringColor}45`,
          borderRadius: 20, padding: '3px 10px',
          fontSize: 10.5, fontWeight: 700, color: ringColor,
        }}>
          {pct}% complete
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '14px 16px', display: 'flex', gap: 18, alignItems: 'center' }}>
        <div style={{ flexShrink: 0 }}>
          <AnimatedRing pct={pct} color={ringColor} size={88} />
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {checklist.steps?.map((step, i) => {
            const meta = STEP_META[step.id] || { icon: '•', color: '#7c6bff' }
            return (
              <div key={step.id} style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '6px 10px', borderRadius: 9,
                background: step.complete ? `${meta.color}0d` : 'rgba(255,255,255,0.025)',
                border: `1px solid ${step.complete ? meta.color + '28' : 'rgba(255,255,255,0.06)'}`,
                transition: 'all 0.3s ease',
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                  background: step.complete ? meta.color : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${step.complete ? meta.color : 'rgba(255,255,255,0.09)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: step.complete ? 11 : 12,
                  color: step.complete ? '#000' : 'inherit',
                  fontWeight: step.complete ? 900 : 400,
                  transition: 'all 0.3s',
                }}>
                  {step.complete ? '✓' : meta.icon}
                </div>
                <div style={{
                  flex: 1, fontSize: 11, fontWeight: 600, minWidth: 0,
                  color: step.complete ? 'rgba(255,255,255,0.38)' : '#e8e8ff',
                  textDecoration: step.complete ? 'line-through' : 'none',
                }}>
                  {step.label}
                </div>
                {!step.complete && step.action_url && (
                  <a href={step.action_url} style={{
                    flexShrink: 0, fontSize: 10, fontWeight: 700, color: meta.color,
                    background: `${meta.color}15`, border: `1px solid ${meta.color}38`,
                    padding: '2px 8px', borderRadius: 6, textDecoration: 'none',
                  }}>Go →</a>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Sample dataset banner */}
      <div style={{
        padding: '10px 16px',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        background: 'rgba(45,212,191,0.04)',
      }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 }}>
          <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>No supplier data yet?</span>{' '}
          We've prepared 10 industry-specific datasets so you can start exploring right away.
        </div>
        <button
          onClick={() => setShowSampleModal(true)}
          style={{
            flexShrink: 0, padding: '6px 14px', borderRadius: 8,
            background: 'linear-gradient(90deg, #7c6bff, #2dd4bf)',
            border: 'none', color: '#fff', fontSize: 11, fontWeight: 700,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          Browse Datasets
        </button>
      </div>

      {/* Progress bar at bottom */}
      <div style={{ height: 3, background: 'rgba(255,255,255,0.05)' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: 'linear-gradient(90deg, #7c6bff, #2dd4bf)',
          transition: 'width 1s ease',
          boxShadow: '0 0 8px rgba(124,107,255,0.5)',
        }} />
      </div>

      {showSampleModal && <SampleDatasetModal onClose={() => setShowSampleModal(false)} />}
    </div>
  )
}
