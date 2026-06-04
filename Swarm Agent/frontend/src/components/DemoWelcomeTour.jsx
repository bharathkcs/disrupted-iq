import React, { useState, useEffect, useRef } from 'react'
import { api } from '../services/api.js'

const AGENTS = [
  { icon: '🛰️', name: 'Monitor',   desc: 'Detects & scores the disruption' },
  { icon: '🧠', name: 'Memory',    desc: 'Recalls similar past events' },
  { icon: '🔗', name: 'Cascade',   desc: 'Spots chain-reaction risks' },
  { icon: '📈', name: 'Forecast',  desc: 'Predicts demand shift %' },
  { icon: '⚠️', name: 'Risk',      desc: 'Scores every supplier 0–100' },
  { icon: '🎯', name: 'Action',    desc: 'Proposes 3 ranked options' },
  { icon: '⚖️', name: 'Validator', desc: 'Cross-checks for disagreement' },
  { icon: '🎲', name: 'Simulate',  desc: 'Monte Carlo P10 / P50 / P90' },
  { icon: '🔄', name: 'Learn',     desc: 'Records outcome for next time' },
]

const STEPS = [
  { tag: 'YOUR SUPPLY NETWORK', title: "You're exploring a real supplier network" },
  { tag: 'HOW THE AI WORKS',    title: '9 AI agents respond together — in 90 seconds' },
  { tag: 'WHAT TO DO',          title: 'Pick a disruption. Watch it respond. Decide.' },
]

function riskColor(r) {
  return r === 'high' ? '#ef4444' : r === 'medium' ? '#f59e0b' : '#10b981'
}
function reliabilityColor(v) {
  return v >= 90 ? '#10b981' : v >= 80 ? '#f59e0b' : '#ef4444'
}

function riskLevel(reliability) {
  return reliability >= 90 ? 'low' : reliability >= 75 ? 'medium' : 'high'
}

export default function DemoWelcomeTour({ onClose, suppliers: externalSuppliers }) {
  const [fetchedSuppliers, setFetchedSuppliers] = useState(null)

  useEffect(() => {
    if (externalSuppliers && externalSuppliers.length > 0) return
    let cancelled = false
    api.suppliers()
      .then(res => {
        if (cancelled) return
        const list = Array.isArray(res) ? res : (Array.isArray(res?.suppliers) ? res.suppliers : [])
        setFetchedSuppliers(list)
      })
      .catch(() => { if (!cancelled) setFetchedSuppliers([]) })
    return () => { cancelled = true }
  }, [externalSuppliers])

  const sourceSuppliers = (externalSuppliers && externalSuppliers.length > 0)
    ? externalSuppliers
    : (fetchedSuppliers || [])

  const displaySuppliers = sourceSuppliers.map(s => ({
    name: s.name,
    zone: s.zone,
    cats: Array.isArray(s.categories) ? s.categories.join(' · ') : (s.categories || ''),
    reliability: s.reliability ?? 85,
    risk: riskLevel(s.reliability ?? 85),
  }))

  const uniqueZones = new Set(displaySuppliers.map(s => s.zone).filter(Boolean))
  const zoneCount = uniqueZones.size

  const [step, setStep] = useState(0)
  const [fading, setFading] = useState(false)
  const [agentIdx, setAgentIdx] = useState(0)
  const [statVals, setStatVals] = useState([0, 0, 0, 0])
  const rafRef = useRef(null)
  const STAT_TARGETS = [displaySuppliers.length, 90, 260, 100]

  // Animate stat counters when step 0 is shown OR when suppliers arrive async
  useEffect(() => {
    if (step !== 0) return
    setStatVals([0, 0, 0, 0])
    const duration = 900
    const start = Date.now()
    const targets = [displaySuppliers.length, 90, 260, 100]
    const tick = () => {
      const p = Math.min((Date.now() - start) / duration, 1)
      const ease = 1 - Math.pow(1 - p, 3)
      setStatVals(targets.map(t => Math.round(t * ease)))
      if (p < 1) { rafRef.current = requestAnimationFrame(tick) }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [step, displaySuppliers.length])

  // Cycle agent highlight on step 1
  useEffect(() => {
    if (step !== 1) return
    const t = setInterval(() => setAgentIdx(i => (i + 1) % AGENTS.length), 650)
    return () => clearInterval(t)
  }, [step])

  const goTo = next => {
    if (fading || next < 0 || next >= STEPS.length) return
    setFading(true)
    setTimeout(() => { setStep(next); setFading(false) }, 220)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(4,6,18,0.85)',
      backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
      padding: 20,
    }}>
      <div style={{
        background: 'linear-gradient(160deg, rgba(18,22,52,0.99) 0%, rgba(10,14,34,0.99) 100%)',
        border: '1px solid rgba(124,107,255,0.22)',
        borderRadius: 20,
        width: '100%', maxWidth: 620,
        maxHeight: '88vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 40px 100px rgba(0,0,0,0.65), 0 0 0 1px rgba(124,107,255,0.08)',
        overflow: 'hidden',
      }}>

        {/* ── Top bar ── */}
        <div style={{
          padding: '16px 22px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize: 9, fontWeight: 800, letterSpacing: '0.12em',
              color: 'var(--primary)',
              background: 'rgba(124,107,255,0.12)',
              border: '1px solid rgba(124,107,255,0.22)',
              padding: '3px 10px', borderRadius: 20,
            }}>{STEPS[step].tag}</span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{step + 1} of {STEPS.length}</span>
          </div>
          <button onClick={onClose} title="Close" style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'var(--text-dim)',
            width: 28, height: 28, borderRadius: 7,
            cursor: 'pointer', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>×</button>
        </div>

        {/* ── Content ── */}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '24px 24px 16px',
          opacity: fading ? 0 : 1,
          transform: fading ? 'translateY(10px)' : 'translateY(0)',
          transition: 'opacity 0.22s ease, transform 0.22s ease',
        }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: '0 0 14px', lineHeight: 1.25 }}>
            {STEPS[step].title}
          </h2>

          {/* STEP 0 — Supplier network */}
          {step === 0 && <>
            <p style={{ fontSize: 13, color: 'var(--text-sec)', marginBottom: 14, lineHeight: 1.7 }}>
              Your supply network spans <strong style={{ color: '#fff' }}>{displaySuppliers.length} supplier{displaySuppliers.length !== 1 ? 's' : ''}</strong> across <strong style={{ color: '#fff' }}>{zoneCount} zone{zoneCount !== 1 ? 's' : ''} globally</strong>. Every disruption scenario you trigger is analysed against this exact network in real time.
            </p>

            {/* Animated stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
              {[
                { label: 'Suppliers', value: statVals[0], suffix: '', color: 'var(--primary)', icon: '🏭' },
                { label: 'Response', value: statVals[1], suffix: 's', color: '#10b981', icon: '⚡' },
                { label: 'Faster', value: statVals[2], suffix: '×', color: '#f59e0b', icon: '🚀' },
                { label: 'Human Approved', value: statVals[3], suffix: '%', color: '#60a5fa', icon: '✅' },
              ].map((stat, i) => (
                <div key={i} style={{
                  padding: '12px 10px',
                  background: `linear-gradient(135deg, ${stat.color}14 0%, ${stat.color}06 100%)`,
                  border: `1px solid ${stat.color}30`,
                  borderRadius: 10,
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{stat.icon}</div>
                  <div style={{
                    fontSize: 22, fontWeight: 800, color: stat.color,
                    fontFamily: 'monospace', lineHeight: 1, marginBottom: 4,
                    transition: 'all 0.1s',
                  }}>
                    {stat.value}{stat.suffix}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.06em' }}>
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Supplier list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {displaySuppliers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-dim)', fontSize: 13 }}>
                  No suppliers uploaded yet. Go to Account Settings → Suppliers to add some.
                </div>
              ) : displaySuppliers.map((s, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 12px',
                  background: 'rgba(255,255,255,0.025)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderLeft: `3px solid ${riskColor(s.risk)}`,
                  borderRadius: 9,
                  animation: `count-up 0.3s ease both`,
                  animationDelay: `${i * 40}ms`,
                }}>
                  <div style={{
                    minWidth: 22, height: 22, borderRadius: 6,
                    background: `${riskColor(s.risk)}18`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 800, color: riskColor(s.risk), fontFamily: 'monospace',
                  }}>{String(i + 1).padStart(2, '0')}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 11.5, fontWeight: 600, color: '#fff', margin: 0 }}>{s.name}</p>
                    <p style={{ fontSize: 9.5, color: 'var(--text-dim)', margin: '1px 0 0' }}>{s.zone} · {s.cats}</p>
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: reliabilityColor(s.reliability), whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {s.reliability}%
                  </div>
                </div>
              ))}
            </div>
            <div style={{
              marginTop: 12, padding: '9px 13px',
              background: 'rgba(124,107,255,0.07)',
              border: '1px solid rgba(124,107,255,0.16)',
              borderRadius: 9, display: 'flex', gap: 8, alignItems: 'center',
            }}>
              <span style={{ fontSize: 14 }}>💡</span>
              <p style={{ fontSize: 11, color: 'var(--text-sec)', margin: 0, lineHeight: 1.5 }}>
                <strong style={{ color: '#fff' }}>Left bar = risk level.</strong> Red = vulnerable (low buffer or reliability). These are the exact suppliers the AI will score when you run a scenario.
              </p>
            </div>
          </>}

          {/* STEP 1 — 9 Agents */}
          {step === 1 && <>
            <p style={{ fontSize: 13, color: 'var(--text-sec)', marginBottom: 18, lineHeight: 1.7 }}>
              The moment a disruption is reported, <strong style={{ color: '#fff' }}>9 specialist AI agents</strong> activate
              — analysing impact, scoring every supplier, and proposing recovery plans.{' '}
              <strong style={{ color: '#fff' }}>You approve every final action.</strong>
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7 }}>
              {AGENTS.map((a, i) => (
                <div key={i} style={{
                  padding: '10px 12px', borderRadius: 10,
                  background: agentIdx === i ? 'rgba(124,107,255,0.16)' : 'rgba(255,255,255,0.025)',
                  border: `1px solid ${agentIdx === i ? 'rgba(124,107,255,0.45)' : 'rgba(255,255,255,0.06)'}`,
                  boxShadow: agentIdx === i ? '0 0 18px rgba(124,107,255,0.18)' : 'none',
                  transform: agentIdx === i ? 'scale(1.04)' : 'scale(1)',
                  transition: 'all 0.3s ease',
                }}>
                  <div style={{ fontSize: 22, marginBottom: 5 }}>{a.icon}</div>
                  <div style={{
                    fontSize: 11, fontWeight: 700, marginBottom: 3,
                    color: agentIdx === i ? 'var(--primary)' : '#fff',
                    transition: 'color 0.3s',
                  }}>{a.name}</div>
                  <div style={{ fontSize: 9.5, color: 'var(--text-dim)', lineHeight: 1.4 }}>{a.desc}</div>
                </div>
              ))}
            </div>
            <div style={{
              marginTop: 16, padding: '12px 16px',
              background: 'rgba(16,185,129,0.08)',
              border: '1px solid rgba(16,185,129,0.2)',
              borderRadius: 10, display: 'flex', gap: 10, alignItems: 'center',
            }}>
              <span style={{ fontSize: 22 }}>⚡</span>
              <p style={{ fontSize: 12, color: 'var(--text-sec)', margin: 0, lineHeight: 1.5 }}>
                Manual analysis: <strong style={{ color: '#ef4444' }}>6+ hours</strong> of calls, spreadsheets and meetings. &nbsp;
                DisruptIQ: <strong style={{ color: '#10b981' }}>90 seconds</strong> — 260× faster.
              </p>
            </div>
          </>}

          {/* STEP 2 — What to do */}
          {step === 2 && <>
            <p style={{ fontSize: 13, color: 'var(--text-sec)', marginBottom: 18, lineHeight: 1.7 }}>
              The demo is ready. Here's all you need to do in three steps:
            </p>
            {[
              {
                icon: '🌀', label: 'STEP 1', title: 'Pick a disruption scenario',
                desc: 'Choose from 5 scenarios in the left panel — cyclones, port strikes, floods, power failures. Each one is linked to specific suppliers in your demo network.',
              },
              {
                icon: '📡', label: 'STEP 2', title: 'Watch the agents respond live',
                desc: 'The Live Activity Feed (top-right panel) lights up as all 9 agents run in real time. Takes about 90 seconds.',
              },
              {
                icon: '✅', label: 'STEP 3', title: 'Review the plan and make your call',
                desc: "Three ranked recovery options appear in the centre. Read the reasoning, pick the best one, and confirm. That's it.",
              },
            ].map((item, i) => (
              <div key={i} style={{
                display: 'flex', gap: 14, marginBottom: 10, alignItems: 'flex-start',
                padding: '14px 16px',
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 10,
              }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 10,
                  background: 'rgba(124,107,255,0.12)',
                  border: '1px solid rgba(124,107,255,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, flexShrink: 0,
                }}>{item.icon}</div>
                <div>
                  <p style={{ fontWeight: 700, fontSize: 13, color: '#fff', margin: '0 0 4px' }}>
                    <span style={{
                      fontSize: 9, fontWeight: 800, color: 'var(--primary)',
                      letterSpacing: '0.08em', marginRight: 7,
                    }}>{item.label}</span>
                    {item.title}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-sec)', margin: 0, lineHeight: 1.6 }}>{item.desc}</p>
                </div>
              </div>
            ))}
            <div style={{
              padding: '10px 14px',
              background: 'rgba(16,185,129,0.07)',
              border: '1px solid rgba(16,185,129,0.18)',
              borderRadius: 9, display: 'flex', gap: 8, alignItems: 'center', marginTop: 6,
            }}>
              <span style={{ fontSize: 15 }}>🔒</span>
              <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0, lineHeight: 1.5 }}>
                No account needed · No data is saved · Explore freely and{' '}
                <strong style={{ color: '#10b981' }}>sign up when you're ready</strong>.
              </p>
            </div>
          </>}
        </div>

        {/* ── Footer nav ── */}
        <div style={{
          padding: '14px 24px 20px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {STEPS.map((_, i) => (
              <div key={i} onClick={() => goTo(i)} style={{
                width: i === step ? 22 : 6, height: 6, borderRadius: 3,
                background: i === step ? 'var(--primary)' : 'rgba(255,255,255,0.18)',
                cursor: 'pointer', transition: 'all 0.3s ease',
              }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button onClick={() => goTo(step - 1)} style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'var(--text-sec)',
                padding: '8px 16px', borderRadius: 8,
                cursor: 'pointer', fontSize: 13,
              }}>← Back</button>
            )}
            {step < STEPS.length - 1 ? (
              <button onClick={() => goTo(step + 1)} style={{
                background: 'linear-gradient(135deg, var(--primary) 0%, #60a5fa 100%)',
                border: 'none', color: '#fff',
                padding: '8px 22px', borderRadius: 8,
                cursor: 'pointer', fontSize: 13, fontWeight: 600,
              }}>Next →</button>
            ) : (
              <button onClick={onClose} style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                border: 'none', color: '#fff',
                padding: '10px 26px', borderRadius: 8,
                cursor: 'pointer', fontSize: 13, fontWeight: 700,
                letterSpacing: '0.02em',
                boxShadow: '0 4px 16px rgba(16,185,129,0.3)',
              }}>Start Exploring →</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
