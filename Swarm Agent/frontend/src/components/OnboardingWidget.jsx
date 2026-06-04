import React, { useEffect, useState, useRef } from 'react'
import { api } from '../services/api.js'

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

      {/* Progress bar at bottom */}
      <div style={{ height: 3, background: 'rgba(255,255,255,0.05)' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: 'linear-gradient(90deg, #7c6bff, #2dd4bf)',
          transition: 'width 1s ease',
          boxShadow: '0 0 8px rgba(124,107,255,0.5)',
        }} />
      </div>
    </div>
  )
}
