import React, { useCallback, useEffect, useRef, useState } from 'react'
import DemoWelcomeTour from '../components/DemoWelcomeTour.jsx'
import { useParams, useNavigate, Outlet, useLocation } from 'react-router-dom'
import { io } from 'socket.io-client'
import { api, SOCKET_URL } from '../services/api.js'
import { authHelpers } from '../services/auth.js'
import SwarmFeed from '../components/SwarmFeed.jsx'
import { EventSummary, MemoryRecall, DissentPanel, CascadeAlert } from '../components/EventPanels.jsx'
import { SupplierRiskTable, DemandChart } from '../components/RiskAndForecast.jsx'
import ActionOptions from '../components/ActionOptions.jsx'
import {
  NLChat, HILConfirm, ResolutionPanel, CounterfactualPanel,
  DemoLauncher, AuditLog, NewsFeed,
} from '../components/HILAndChat.jsx'
import ResilienceScore from '../components/ResilienceScore.jsx'
import DataQualityMeter from '../components/DataQualityMeter.jsx'
import ReportDisruptionModal from '../components/ReportDisruptionModal.jsx'
import OnboardingWidget from '../components/OnboardingWidget.jsx'
import ScenarioCreator from '../components/ScenarioCreator.jsx'
import AnomalyAlerts from '../components/AnomalyAlerts.jsx'
import BeforeAfterPanel from '../components/BeforeAfterPanel.jsx'
import MemoryLedgerPanel from '../components/MemoryLedgerPanel.jsx'
import DailyRiskBriefing from '../components/DailyRiskBriefing.jsx'

function MetricsBar() {
  const [summary, setSummary] = useState(null)
  const [bannerPhase, setBannerPhase] = useState('full') // 'full' | 'dissolving' | 'mini'
  const [insightsPhase, setInsightsPhase] = useState('hidden') // 'hidden' | 'full' | 'dissolving' | 'mini'
  const [threatPhase, setThreatPhase] = useState('hidden') // 'hidden' | 'full' | 'dissolving' | 'mini'
  const [suppliers, setSuppliers] = useState([])
  const [insightsDismissed, setInsightsDismissed] = useState(false)
  const [threatDismissed, setThreatDismissed] = useState(false)

  useEffect(() => {
    const load = () => api.reportsSummary().then(setSummary).catch(() => {})
    load()
    const timer = setInterval(load, 30000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    api.suppliers().then(data => {
      console.log('Raw suppliers response:', data)
      const suppliersList = Array.isArray(data) ? data : (data?.suppliers ? data.suppliers : [])
      console.log('Suppliers loaded:', suppliersList.length, suppliersList)
      setSuppliers(suppliersList)
    }).catch(err => {
      console.error('Failed to load suppliers:', err)
      setSuppliers([])
    })
  }, [])

  // Staggered cascade: Platform (0-10s) → Insights (10-20s) → Threat (20-30s)
  useEffect(() => {
    const t1 = setTimeout(() => setBannerPhase('dissolving'), 10000)
    const t2 = setTimeout(() => { setBannerPhase('mini'); setInsightsPhase('full') }, 10950)
    const t3 = setTimeout(() => setInsightsPhase('dissolving'), 20000)
    const t4 = setTimeout(() => { setInsightsPhase('mini'); setThreatPhase('full') }, 20950)
    const t5 = setTimeout(() => setThreatPhase('dissolving'), 30000)
    const t6 = setTimeout(() => setThreatPhase('mini'), 30950)
    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3)
      clearTimeout(t4); clearTimeout(t5); clearTimeout(t6)
    }
  }, [])

  // Compute supplier insights from live data
  const insights = React.useMemo(() => {
    if (!suppliers.length) return []
    const zoneCounts = {}
    suppliers.forEach(s => { if (s.zone) zoneCounts[s.zone] = (zoneCounts[s.zone] || 0) + 1 })
    const topZone = Object.entries(zoneCounts).sort((a, b) => b[1] - a[1])[0]
    const avgReliability = Math.round(suppliers.reduce((s, x) => s + (x.reliability_pct || 0), 0) / suppliers.length)
    const avgBuffer = Math.round(suppliers.reduce((s, x) => s + (x.buffer_stock_days || 0), 0) / suppliers.length)
    const atRisk = suppliers.filter(s => (s.reliability_pct || 100) < 80).length

    // Handle categories as either string or array
    const allCats = new Set(suppliers.flatMap(s => {
      const cats = s.categories || []
      return Array.isArray(cats) ? cats : String(cats).split(',').map(c => c.trim()).filter(Boolean)
    }))

    const multiSiteCount = suppliers.filter(s => (s.sites || 1) > 1).length
    return [
      { icon: '🏭', label: 'Supplier Fleet',   value: `${suppliers.length}`, desc: `${allCats.size} product categories`,          color: '#7c6bff' },
      { icon: '📍', label: 'Top Zone',          value: topZone?.[0] || '—',  desc: `${topZone?.[1] || 0} suppliers concentrated`, color: '#2dd4bf' },
      { icon: '⚡', label: 'Avg Reliability',   value: `${avgReliability}%`, desc: avgReliability >= 85 ? 'Fleet is healthy ✓' : 'Below 85% target', color: avgReliability >= 85 ? '#10b981' : '#f59e0b' },
      { icon: '📦', label: 'Avg Buffer Stock',  value: `${avgBuffer}d`,      desc: 'Days of inventory cover',                    color: '#60a5fa' },
      { icon: '⚠️', label: 'At-Risk Suppliers', value: `${atRisk}`,          desc: atRisk === 0 ? 'All above threshold' : 'Reliability < 80%', color: atRisk > 0 ? '#ef4444' : '#10b981' },
      { icon: '🔀', label: 'Multi-Site',        value: `${multiSiteCount}`,  desc: 'Suppliers with redundancy',                  color: '#ec4899' },
    ]
  }, [suppliers])

  const sla = summary?.sla_compliance_pct ?? 0
  const cards = [
    {
      label: 'Total Disruptions', icon: '📊', accent: '#7c6bff',
      value: summary?.total_events ?? '—',
      sub: `Today: ${summary?.events_today ?? 0}`,
      bar: Math.min(100, (summary?.total_events ?? 0) * 10),
      badge: '+12% vs yesterday',
    },
    {
      label: 'Response Speed', icon: '⚡', accent: sla >= 90 ? '#10b981' : sla >= 70 ? '#f59e0b' : '#ef4444',
      value: summary ? `${sla}%` : '—',
      sub: 'Responded in <90s',
      bar: sla,
      badge: sla >= 90 ? 'On target' : 'Needs attention',
    },
    {
      label: 'Avg Response Time', icon: '⏱️', accent: '#60a5fa',
      value: summary?.avg_response_minutes ? `${summary.avg_response_minutes}m` : '—',
      sub: 'Target: <1.5m',
      bar: summary?.avg_response_minutes ? Math.max(0, 100 - summary.avg_response_minutes * 40) : 50,
      badge: 'SLA tracked',
    },
    {
      label: 'Expert Disagreement', icon: '⚠️', accent: '#f59e0b',
      value: summary ? `${summary.dissent_rate_pct}%` : '—',
      sub: 'When AI agents split',
      bar: Math.min(100, (summary?.dissent_rate_pct ?? 0) * 3),
      badge: 'Validator active',
    },
    {
      label: 'Chain Reactions', icon: '🔗', accent: '#f97316',
      value: summary?.cascade_events ?? '0',
      sub: 'Last 2 days',
      bar: Math.min(100, (summary?.cascade_events ?? 0) * 20),
      badge: '-3 vs last week',
    },
    {
      label: "What We've Learned", icon: '🧠', accent: '#ec4899',
      value: summary?.memory_records ?? '0',
      sub: 'Past experiences',
      bar: Math.min(100, (summary?.memory_records ?? 0) * 8),
      badge: '+8 new patterns',
    },
  ]

  const BANNER_STEPS = [
    { icon: '🔍', label: 'Spot Early',    desc: 'News & weather feeds flag anomalies before they reach your gates',     color: '#7c6bff' },
    { icon: '📊', label: 'Assess Impact', desc: 'Severity scored against your zones, categories & buffer levels',       color: '#2dd4bf' },
    { icon: '🧭', label: 'Recommend',     desc: 'Three ranked recovery paths with RTO tags and trade-off breakdowns',   color: '#f59e0b' },
    { icon: '🧠', label: 'Learn & Adapt', desc: 'Counterfactual memory calibrates every future forecast automatically', color: '#ec4899' },
  ]

  return (
    <div style={{ padding: '14px 16px 0', maxWidth: 1700, margin: '0 auto', width: '100%' }}>
      <style>{`
        @keyframes kpi-in {
          0%   { opacity: 0; transform: translateY(16px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes kpi-bar-fill {
          from { width: 0%; }
        }
        @keyframes kpi-dot-pulse {
          0%, 100% { box-shadow: 0 0 0 0 currentColor; opacity: 1; }
          50% { box-shadow: 0 0 0 4px transparent; opacity: 0.7; }
        }
        @keyframes kpi-shimmer {
          0%   { left: -60%; }
          100% { left: 130%; }
        }
        @keyframes thanos-dust {
          0%   { opacity: 1; filter: blur(0px) brightness(1); transform: scale(1) skewX(0deg); clip-path: inset(0 0% 0 0 round 0px); }
          20%  { opacity: 0.9; filter: blur(1px) brightness(1.3); transform: scale(1.01) skewX(-1deg); clip-path: inset(0 0% 0 0 round 4px); }
          45%  { opacity: 0.6; filter: blur(4px) brightness(0.8); transform: scale(0.97) skewX(2deg); clip-path: inset(5% 15% 5% 0 round 8px); }
          70%  { opacity: 0.25; filter: blur(9px) brightness(0.5); transform: scale(0.9) skewX(-3deg); clip-path: inset(10% 50% 10% 0 round 16px); }
          100% { opacity: 0; filter: blur(16px) brightness(0); transform: scale(0.6) skewX(4deg); clip-path: inset(20% 100% 20% 0 round 24px); }
        }
        @keyframes mini-pill-in {
          from { opacity: 0; transform: scale(0.3) rotate(-12deg); }
          60%  { transform: scale(1.08) rotate(2deg); }
          to   { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        @keyframes radar-pulse {
          0%   { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        @keyframes shimmer-banner {
          0%   { background-position: -300% 0; }
          100% { background-position:  300% 0; }
        }
        @keyframes card-glow-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        @keyframes countdown-drain {
          from { width: 100%; }
          to   { width: 0%; }
        }
        @keyframes insight-panel-in {
          from { opacity: 0; transform: translateY(-12px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes insight-cell-in {
          from { opacity: 0; transform: translateX(-14px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes dot-orbit {
          from { transform: rotate(0deg) translateX(5px); }
          to   { transform: rotate(360deg) translateX(5px); }
        }
      `}</style>

      {/* ── KPI Cards — Clean Professional Business Metrics ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 16 }}>
        {cards.map((card, i) => (
          <div key={card.label}
            style={{
              position: 'relative',
              borderRadius: 14,
              background: 'rgba(255,255,255,0.035)',
              border: '1px solid rgba(255,255,255,0.08)',
              overflow: 'hidden',
              animation: `kpi-in 0.4s ease-out ${i * 60}ms both`,
              transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, background 0.2s ease',
              cursor: 'default',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-3px)';
              e.currentTarget.style.boxShadow = `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px ${card.accent}55`;
              e.currentTarget.style.borderColor = `${card.accent}55`;
              e.currentTarget.style.background = `rgba(255,255,255,0.055)`;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
              e.currentTarget.style.background = 'rgba(255,255,255,0.035)';
            }}
          >
            {/* Accent top border */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 2,
              background: `linear-gradient(90deg, transparent, ${card.accent}, transparent)`,
              opacity: 0.9,
            }} />

            {/* Shimmer sweep on load */}
            <div style={{
              position: 'absolute', top: 0, bottom: 0, width: '50%',
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent)',
              animation: `kpi-shimmer 1.8s ease ${i * 80}ms 1`,
              pointerEvents: 'none',
            }} />

            <div style={{ padding: '16px 18px 18px' }}>
              {/* Header row: label + icon */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                    background: card.accent, flexShrink: 0,
                    color: card.accent,
                    animation: 'kpi-dot-pulse 2.5s ease-in-out infinite',
                    animationDelay: `${i * 300}ms`,
                  }} />
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    color: 'rgba(255,255,255,0.5)',
                  }}>
                    {card.label}
                  </span>
                </div>
                <span style={{
                  fontSize: 16,
                  opacity: 0.45,
                  lineHeight: 1,
                  filter: 'grayscale(0.3)',
                }}>
                  {card.icon}
                </span>
              </div>

              {/* Big value */}
              <div style={{
                fontSize: 38,
                fontWeight: 800,
                lineHeight: 1,
                color: '#ffffff',
                letterSpacing: '-1px',
                fontVariantNumeric: 'tabular-nums',
                marginBottom: 4,
                fontFamily: 'Inter, -apple-system, sans-serif',
              }}>
                {card.value}
              </div>

              {/* Subtitle */}
              <div style={{
                fontSize: 11.5,
                color: 'rgba(255,255,255,0.38)',
                marginBottom: 14,
                fontWeight: 400,
              }}>
                {card.sub}
              </div>

              {/* Progress track */}
              <div style={{
                height: 3, borderRadius: 99,
                background: 'rgba(255,255,255,0.07)',
                overflow: 'hidden',
                marginBottom: 12,
              }}>
                <div style={{
                  height: '100%',
                  width: `${card.bar}%`,
                  borderRadius: 99,
                  background: `linear-gradient(90deg, ${card.accent}99, ${card.accent})`,
                  animation: `kpi-bar-fill 1s cubic-bezier(0.22,1,0.36,1) ${i * 70}ms both`,
                  transition: 'width 0.6s ease',
                }} />
              </div>

              {/* Status pill */}
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 10.5, fontWeight: 600,
                color: card.accent,
                background: `${card.accent}18`,
                border: `1px solid ${card.accent}30`,
                borderRadius: 6,
                padding: '3px 9px',
              }}>
                <span style={{ fontSize: 9 }}>●</span>
                {card.badge}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Banner: dissolves after 10s → mini pill ── */}
      {/* Mini pills row — always visible when any is minimized, no dismissals allowed */}
      {(bannerPhase === 'mini' || insightsPhase === 'mini' || threatPhase === 'mini') && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 14, minHeight: 32 }}>
          {bannerPhase === 'mini' && (
            <button
              onClick={() => { setBannerPhase('full'); setInsightsDismissed(false) }}
              title="Show Platform Intelligence Panel"
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '5px 14px 5px 10px', borderRadius: 22,
                background: 'linear-gradient(135deg,rgba(124,107,255,0.15),rgba(45,212,191,0.08))',
                border: '1px solid rgba(124,107,255,0.35)',
                color: '#a99cff', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                animation: 'mini-pill-in 0.6s cubic-bezier(0.34,1.56,0.64,1) both',
                boxShadow: '0 0 12px rgba(124,107,255,0.2)',
              }}
            >
              <span style={{ fontSize: 16 }}>📡</span>
              <span>Platform Intel</span>
              <span style={{ fontSize: 9, opacity: 0.55, marginLeft: 2 }}>↗</span>
            </button>
          )}
          {insightsPhase === 'mini' && (
            <button
              onClick={() => { setInsightsPhase('full'); setInsightsDismissed(false) }}
              title="Show Supplier Glance Panel"
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '5px 14px 5px 10px', borderRadius: 22,
                background: 'linear-gradient(135deg,rgba(45,212,191,0.15),rgba(96,165,250,0.08))',
                border: '1px solid rgba(45,212,191,0.35)',
                color: '#5eead4', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                animation: 'mini-pill-in 0.6s cubic-bezier(0.34,1.56,0.64,1) both',
                boxShadow: '0 0 12px rgba(45,212,191,0.2)',
              }}
            >
              <span style={{ fontSize: 16 }}>🏭</span>
              <span>Supplier Glance</span>
              <span style={{ fontSize: 9, opacity: 0.55, marginLeft: 2 }}>↗</span>
            </button>
          )}
          {threatPhase === 'mini' && (
            <button
              onClick={() => { setThreatPhase('full'); setThreatDismissed(false) }}
              title="Show Crisis Timeline Panel"
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '5px 14px 5px 10px', borderRadius: 22,
                background: 'linear-gradient(135deg,rgba(168,85,247,0.15),rgba(139,92,246,0.08))',
                border: '1px solid rgba(168,85,247,0.35)',
                color: '#d8b4fe', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                animation: 'mini-pill-in 0.6s cubic-bezier(0.34,1.56,0.64,1) both',
                boxShadow: '0 0 12px rgba(168,85,247,0.2)',
              }}
            >
              <span style={{ fontSize: 16 }}>🔮</span>
              <span>Crisis Timeline</span>
              <span style={{ fontSize: 9, opacity: 0.55, marginLeft: 2 }}>↗</span>
            </button>
          )}
        </div>
      )}

      {/* ── Supply Chain Insight Snapshot — appears after banner dissolves (10-20s) ── */}
      {insightsPhase === 'full' && (
        <div style={{
          marginBottom: 14, borderRadius: 16, overflow: 'hidden',
          border: '1px solid rgba(45,212,191,0.2)',
          background: 'linear-gradient(135deg, rgba(45,212,191,0.06) 0%, rgba(96,165,250,0.04) 50%, rgba(124,107,255,0.06) 100%)',
          animation: `insight-panel-in 0.55s cubic-bezier(0.22,1,0.36,1) both${insightsPhase === 'dissolving' ? ',thanos-dust 0.95s ease-in forwards' : ''}`,
          boxShadow: '0 4px 24px rgba(45,212,191,0.08)',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px 10px',
            borderBottom: '1px solid rgba(45,212,191,0.12)',
            background: 'rgba(45,212,191,0.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ position: 'relative', width: 28, height: 28, flexShrink: 0 }}>
                <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid rgba(45,212,191,0.4)', animation: 'radar-pulse 2.2s ease-out infinite' }} />
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,rgba(45,212,191,0.25),rgba(96,165,250,0.2))', border: '1px solid rgba(45,212,191,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>🔬</div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#2dd4bf', letterSpacing: '0.02em' }}>Your Supply Chain at a Glance</div>
                <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 1 }}>Live insights computed from your {suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 12, background: 'rgba(45,212,191,0.1)', border: '1px solid rgba(45,212,191,0.25)' }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#2dd4bf', animation: 'card-glow-pulse 1.4s ease-in-out infinite' }} />
                <span style={{ fontSize: 8, fontWeight: 800, color: '#2dd4bf', letterSpacing: '0.1em' }}>LIVE DATA</span>
              </div>
              <button onClick={() => setInsightsPhase('mini')} title="Collapse" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.3)', borderRadius: 7, width: 22, height: 22, cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
            </div>
          </div>

          {/* Insight cells */}
          {insights.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 0 }}>
              {insights.map((item, i) => (
                <div key={item.label} style={{
                  padding: '14px 14px 12px',
                  borderRight: i < insights.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                  position: 'relative', overflow: 'hidden',
                  animation: `insight-cell-in 0.4s ease-out ${i * 60}ms both`,
                  transition: 'background 0.18s',
                  cursor: 'default',
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${item.color}0a` }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  {/* top accent line */}
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: item.color, opacity: 0.6, borderRadius: '2px 2px 0 0' }} />

                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 13 }}>{item.icon}</span>
                    <span style={{ fontSize: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: item.color }}>{item.label}</span>
                  </div>

                  <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', fontFamily: 'monospace', lineHeight: 1, marginBottom: 5, textShadow: `0 0 16px ${item.color}50` }}>
                    {item.value}
                  </div>

                  <div style={{ fontSize: 9.5, color: 'var(--text-sec)', lineHeight: 1.4 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
              <div style={{ marginBottom: 8 }}>📋 No suppliers uploaded yet</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Upload your supplier list from Account → Onboarding to see live insights</div>
            </div>
          )}
        </div>
      )}

      {bannerPhase !== 'mini' && (
        <div style={{
          position: 'relative', overflow: 'hidden', borderRadius: 16, marginBottom: 14,
          background: 'linear-gradient(135deg, rgba(124,107,255,0.08) 0%, rgba(45,212,191,0.05) 50%, rgba(124,107,255,0.04) 100%)',
          border: '1px solid rgba(124,107,255,0.22)', padding: '16px 18px',
          animation: bannerPhase === 'dissolving' ? 'thanos-dust 0.95s ease-in forwards' : 'none',
          transformOrigin: 'center center',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 2,
            background: 'linear-gradient(90deg,transparent,#7c6bff,#2dd4bf,#7c6bff,transparent)',
            backgroundSize: '300% 100%', animation: 'shimmer-banner 3s linear infinite',
          }} />
          {bannerPhase === 'full' && (
            <div style={{
              position: 'absolute', bottom: 0, left: 0, height: 2,
              background: 'linear-gradient(90deg,#7c6bff,#2dd4bf)',
              animation: 'countdown-drain 10s linear forwards',
            }} />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{ position: 'relative', width: 38, height: 38, flexShrink: 0 }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid rgba(45,212,191,0.5)', animation: 'radar-pulse 1.8s ease-out infinite' }} />
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg,rgba(124,107,255,0.35),rgba(45,212,191,0.25))', border: '1px solid rgba(124,107,255,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📡</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: 13, fontWeight: 800, letterSpacing: '0.03em',
                background: 'linear-gradient(90deg,#7c6bff,#2dd4bf,#7c6bff)', backgroundSize: '300% 100%',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                animation: 'shimmer-banner 4s linear infinite', display: 'inline-block',
              }}>How We Stay Ahead of Disruptions</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>AI-powered early-warning intelligence · auto-collapsing in 10s</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 20, padding: '3px 10px' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', animation: 'card-glow-pulse 1.2s ease-in-out infinite' }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: '#10b981', letterSpacing: '0.1em' }}>LIVE</span>
              </div>
              <button onClick={() => setBannerPhase('mini')} title="Collapse" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.35)', borderRadius: 8, width: 24, height: 24, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {BANNER_STEPS.map(({ icon, label, desc, color }, idx) => (
              <div key={label} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${color}28`, borderRadius: 12, padding: '12px 10px', animation: `stat-card-in 0.5s ease-out ${idx * 80}ms both`, transition: 'border-color 0.2s, box-shadow 0.2s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = color + '66'; e.currentTarget.style.boxShadow = `0 0 16px ${color}22`; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = color + '28'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Crisis Timeline — appears at 20-30s (UNIQUE: Live event stream visualization) ── */}
      {threatPhase === 'full' && (
        <div style={{
          marginBottom: 14, borderRadius: 16, overflow: 'hidden',
          border: '1px solid rgba(168,85,247,0.25)',
          background: 'linear-gradient(135deg, rgba(168,85,247,0.07) 0%, rgba(139,92,246,0.05) 50%, rgba(168,85,247,0.05) 100%)',
          animation: `insight-panel-in 0.55s cubic-bezier(0.22,1,0.36,1) both${threatPhase === 'dissolving' ? ',thanos-dust 0.95s ease-in forwards' : ''}`,
          boxShadow: '0 4px 24px rgba(168,85,247,0.08)',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px 10px',
            borderBottom: '1px solid rgba(168,85,247,0.12)',
            background: 'rgba(168,85,247,0.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ position: 'relative', width: 28, height: 28, flexShrink: 0 }}>
                <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid rgba(168,85,247,0.4)', animation: 'radar-pulse 2.2s ease-out infinite' }} />
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,rgba(168,85,247,0.25),rgba(139,92,246,0.2))', border: '1px solid rgba(168,85,247,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>🔮</div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#d8b4fe', letterSpacing: '0.02em' }}>Crisis Timeline</div>
                <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 1 }}>Live disruption event stream flowing through your network</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 12, background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.25)' }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#a855f7', animation: 'card-glow-pulse 1.4s ease-in-out infinite' }} />
                <span style={{ fontSize: 8, fontWeight: 800, color: '#d8b4fe', letterSpacing: '0.1em' }}>STREAMING</span>
              </div>
              <button onClick={() => setThreatPhase('mini')} title="Collapse" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.3)', borderRadius: 7, width: 22, height: 22, cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
            </div>
          </div>

          {/* Event cells grid — matching other containers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 0 }}>
            {[
              { icon: '📦', label: 'Active Alerts', value: '5', color: '#ef4444', desc: 'Last 24 hours' },
              { icon: '⏰', label: 'Latest Event', value: '2m', color: '#f97316', desc: 'ago' },
              { icon: '📍', label: 'Zones Hit', value: '3', color: '#a855f7', desc: 'Supply disrupted' },
              { icon: '🔗', label: 'Suppliers', value: '8', color: '#10b981', desc: 'Activated backups' },
              { icon: '⚡', label: 'Response', value: '1.2m', color: '#06b6d4', desc: 'Avg reaction time' },
              { icon: '📊', label: 'Severity', value: 'HIGH', color: '#ef4444', desc: 'System status' },
            ].map((item, i) => (
              <div key={item.label} style={{
                padding: '14px 14px 12px',
                borderRight: i < 5 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                position: 'relative', overflow: 'hidden',
                animation: `insight-cell-in 0.4s ease-out ${i * 60}ms both`,
                transition: 'background 0.18s',
                cursor: 'default',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = `${item.color}0a` }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: item.color, opacity: 0.6, borderRadius: '2px 2px 0 0' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 13 }}>{item.icon}</span>
                  <span style={{ fontSize: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: item.color }}>{item.label}</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', fontFamily: 'monospace', lineHeight: 1, marginBottom: 5, textShadow: `0 0 16px ${item.color}50` }}>
                  {item.value}
                </div>
                <div style={{ fontSize: 9.5, color: 'var(--text-sec)', lineHeight: 1.4 }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Dashboard({ statusInfo, onHeaderStateChange, demoMode = false }) {
  const { client_id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [feed, setFeed] = useState([])
  const [activeEventId, setActiveEventId] = useState(null)
  const [state, setState] = useState(null)
  const [swarmStartTime, setSwarmStartTime] = useState(null)
  const [swarmComplete, setSwarmComplete] = useState(false)
  const [counterfactuals, setCounterfactuals] = useState([])
  const [reloadKey, setReloadKey] = useState(0)
  const [suppliers, setSuppliers] = useState(null)
  const [isReportModalOpen, setIsReportModalOpen] = useState(false)
  const [authChecked, setAuthChecked] = useState(demoMode)
  const [checklist, setChecklist] = useState(null)
  const [onboardingDismissed, setOnboardingDismissed] = useState(!!localStorage.getItem('onboarding_dismissed'))
  const stateRef = useRef(null)
  const [tourOpen, setTourOpen] = useState(demoMode)
  const [clientTourOpen, setClientTourOpen] = useState(false)

  // Auth guard: the authenticated dashboard requires a valid token. Without one,
  // the backend would serve demo data — so redirect to login instead of leaking
  // the wrong mode. Demo mode (/demo) skips this entirely.
  useEffect(() => {
    if (demoMode) {
      setAuthChecked(true)
      return
    }
    const token = authHelpers.getToken()
    if (!token) {
      navigate(`/login?returnUrl=/dashboard/${client_id || ''}`)
      return
    }
    api.getCurrentUser()
      .then(me => {
        if (client_id && me.client_id && me.client_id !== client_id) {
          navigate(`/dashboard/${me.client_id}`, { replace: true })
          return
        }
        setAuthChecked(true)
      })
      .catch(() => {
        authHelpers.clearAuth()
        navigate('/login')
      })
  }, [demoMode, client_id, navigate])

  useEffect(() => {
    if (!demoMode && client_id && authChecked) {
      api.suppliers().then(r => setSuppliers(r.suppliers || r || [])).catch(() => {
        console.error('Failed to load suppliers for client', client_id)
      })
      api.onboardingChecklist().then(setChecklist).catch(() => {})
    }
  }, [client_id, demoMode, authChecked])

  useEffect(() => {
    api.counterfactuals().then(setCounterfactuals).catch(() => {})
  }, [reloadKey])

  useEffect(() => {
    stateRef.current = state
    onHeaderStateChange?.({
      activeEventId,
      status: state?.status || null,
    })
  }, [activeEventId, state, onHeaderStateChange])

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      auth: { token: authHelpers.getToken() || '' },
    })
    socket.on('swarm_update', evt => {
      setFeed(f => [...f.slice(-200), evt])
      const eid = evt.event_id
      // Stop timer only on hard terminal failures — successful completion is
      // detected by watching state.action.options in the useEffect below.
      const terminalStatus = ['error', 'failed', 'timeout', 'below_threshold', 'hil_required'].includes(evt.status)
      if (terminalStatus) setSwarmComplete(true)
      if (!eid || eid === 'pending') return
      setActiveEventId(prev => prev || eid)
      api.getEvent(eid).then(s => {
        const prev = stateRef.current
        setState({ ...s, selected_option: prev?.selected_option })
      }).catch(() => {})
    })
    return () => socket.disconnect()
  }, [])

  const triggerEvent = useCallback(async payload => {
    setFeed([])
    setState(null)
    setActiveEventId(null)
    setSwarmComplete(false)
    setSwarmStartTime(Date.now())
    const result = await api.triggerEvent(payload)
    setActiveEventId(result.event_id)
    setState(result)
  }, [])

  const triggerChaos = useCallback(async () => {
    setFeed([])
    setState(null)
    setActiveEventId(null)
    setSwarmComplete(false)
    setSwarmStartTime(Date.now())
    try {
      const r = await api.triggerChaosMode()
      if (r?.event_ids?.length) setActiveEventId(r.event_ids[0])
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Chaos mode failed', e)
    }
  }, [])

  const handleAck = useCallback(async ackType => {
    if (!activeEventId) return
    await api.acknowledge({ event_id: activeEventId, ack_type: ackType, reviewer_id: 'SC-Lead-001' })
    const fresh = await api.getEvent(activeEventId)
    setState(prev => ({ ...fresh, selected_option: prev?.selected_option }))
  }, [activeEventId])

  const selectOption = useCallback(rank => {
    setState(prev => ({ ...prev, selected_option: rank }))
  }, [])

  const onConfirmed = useCallback(async () => {
    if (!activeEventId) return
    const fresh = await api.getEvent(activeEventId)
    setState(prev => ({ ...fresh, selected_option: prev?.selected_option }))
  }, [activeEventId])

  const onResolved = useCallback(async () => {
    const cfs = await api.counterfactuals()
    setCounterfactuals(cfs)
    setReloadKey(k => k + 1)
    if (activeEventId) {
      const fresh = await api.getEvent(activeEventId)
      setState(prev => ({ ...fresh, selected_option: prev?.selected_option }))
    }
  }, [activeEventId])

  const monitor = state?.monitor
  const memRecalls = state?.memory_recalls?.filter(m => m.stage === 2 || m.actual_outcome) || []
  const cascade = state?.cascade_alert
  const dissent = state?.divergence
  const risk = state?.risk
  const forecast = state?.forecast
  const action = state?.action
  const sim = state?.simulation
  const acks = state?.acknowledgements || {}
  const statusKey = state?.status

  // Stop the timer the moment recommended actions are actually populated in state —
  // this is when ActionOptions renders and the user can see the options.
  useEffect(() => {
    if (action?.options?.length > 0 && swarmStartTime && !swarmComplete) {
      setSwarmComplete(true)
    }
  }, [action, swarmStartTime, swarmComplete])

  // If a nested child route is active (under /dashboard/:client_id or /demo), render it via Outlet.
  const basePath = client_id ? `/dashboard/${client_id}` : '/demo'
  const hasChildRoute = location.pathname !== basePath && location.pathname.startsWith(basePath)

  if (hasChildRoute) {
    return <Outlet />
  }

  if (!authChecked) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-sec)', fontSize: 14 }}>
        Verifying your session…
      </div>
    )
  }

  return (
    <>
      <style>{`@keyframes swarm-step-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
      {demoMode && tourOpen && <DemoWelcomeTour onClose={() => setTourOpen(false)} suppliers={suppliers || []} />}
      {!demoMode && clientTourOpen && <DemoWelcomeTour onClose={() => setClientTourOpen(false)} suppliers={suppliers || []} />}

      {/* Floating tour re-open button — demo mode */}
      {demoMode && !tourOpen && (
        <button
          onClick={() => setTourOpen(true)}
          title="Reopen tour"
          style={{
            position: 'fixed', bottom: 28, right: 28, zIndex: 1500,
            width: 44, height: 44, borderRadius: 22,
            background: 'linear-gradient(135deg, var(--primary) 0%, #60a5fa 100%)',
            border: 'none', color: '#fff',
            fontSize: 18, fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(124,107,255,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >?</button>
      )}

      {/* Floating "View Your Suppliers" button — onboarding mode */}
      {!demoMode && suppliers && (
        <button
          onClick={() => setClientTourOpen(true)}
          title="View your suppliers"
          style={{
            position: 'fixed', bottom: 28, right: 28, zIndex: 1500,
            height: 44, borderRadius: 22,
            padding: '0 18px',
            background: 'linear-gradient(135deg, var(--primary) 0%, #2dd4bf 100%)',
            border: 'none', color: '#fff',
            fontSize: 13, fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(124,107,255,0.45)',
            display: 'flex', alignItems: 'center', gap: 8,
            animation: 'swarm-step-in 0.5s ease-out both',
          }}
        >
          <span style={{ fontSize: 16 }}>📦</span> View Your Suppliers
        </button>
      )}

      <MetricsBar />
      {!demoMode && (
        <div style={{ padding: '0 16px', maxWidth: 1700, margin: '0 auto', width: '100%' }}>
          <DailyRiskBriefing refreshKey={activeEventId} />
        </div>
      )}
      <div style={{ padding: '0 16px', maxWidth: 1700, margin: '0 auto', width: '100%', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <ResilienceScore />
        <DataQualityMeter />
      </div>

      {!demoMode && checklist && checklist.progress_pct < 100 && !onboardingDismissed && (
        <div style={{ padding: '0 16px', maxWidth: 1700, margin: '0 auto', width: '100%' }}>
          <div style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 16, alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-pri)', whiteSpace: 'nowrap' }}>
              Getting Started · {checklist.progress_pct}% complete
            </span>
            <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${checklist.progress_pct}%`, height: '100%', background: 'var(--primary)', borderRadius: 2 }} />
            </div>
            <a href={`/dashboard/${client_id}/settings/onboarding`} style={{ fontSize: 12, color: 'var(--primary)', textDecoration: 'none', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              View Steps →
            </a>
            <button
              onClick={() => {
                setOnboardingDismissed(true)
                localStorage.setItem('onboarding_dismissed', '1')
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                fontSize: 16,
                cursor: 'pointer',
                padding: '4px 8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr) 460px', gap: 14, maxWidth: 1700, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {!demoMode && <OnboardingWidget />}
          {demoMode && <DemoLauncher onTrigger={triggerEvent} />}
          {demoMode && (
            <button
              onClick={triggerChaos}
              style={{
                padding: '14px 16px',
                background: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
                color: '#0f1115', border: 0, borderRadius: 10,
                fontWeight: 800, fontSize: 14, letterSpacing: 0.3,
                cursor: 'pointer',
                boxShadow: '0 10px 24px rgba(239,68,68,0.32)',
              }}
              title="Fire 3 simultaneous global disruptions"
            >
              ⚡ Chaos Mode — Simulate 3 Simultaneous Disruptions
            </button>
          )}
          <NewsFeed />
          {!demoMode && <ScenarioCreator onTrigger={triggerEvent} suppliers={suppliers || []} />}
          {!demoMode && (
            <div className="panel" style={{ padding: '16px', background: 'linear-gradient(135deg, rgba(239,68,68,0.1) 0%, rgba(220,38,38,0.05) 100%)', border: '1px solid rgba(239,68,68,0.3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <span style={{ fontSize: '20px' }}>📋</span>
                <h3 style={{ margin: 0, color: '#fff', fontSize: '14px', fontWeight: '700' }}>Report Disruption</h3>
              </div>
              <p style={{ margin: '0 0 12px 0', color: '#d1d5db', fontSize: '12px', lineHeight: '1.5' }}>
                Report a supply chain disruption event. Our swarm intelligence team will analyze and provide recommendations within 90 seconds.
              </p>
              <button
                onClick={() => setIsReportModalOpen(true)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => e.target.style.background = 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)'}
                onMouseLeave={(e) => e.target.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'}
              >
                + Report Event
              </button>
            </div>
          )}
          {statusKey === 'confirmed' && <ResolutionPanel eventId={activeEventId} onResolved={onResolved} />}
          {counterfactuals.length > 0 && <CounterfactualPanel records={counterfactuals} />}
          <AuditLog />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {!demoMode && <AnomalyAlerts />}
          {(swarmStartTime || activeEventId) && (
            <BeforeAfterPanel swarmStartTime={swarmStartTime} swarmComplete={swarmComplete} />
          )}
          <EventSummary monitor={monitor} cascade={cascade} />
          {cascade && <CascadeAlert cascade={cascade} onAck={() => handleAck('cascade')} acknowledged={'cascade' in acks} />}
          {memRecalls.length > 0 && <MemoryRecall memories={memRecalls} onAck={() => handleAck('memory')} acknowledged={'memory' in acks} />}
          {dissent?.dissent_detected && <DissentPanel divergence={dissent} onAck={() => handleAck('dissent')} acknowledged={'dissent' in acks} />}
          {risk && <SupplierRiskTable riskData={risk} />}
          {forecast && <DemandChart forecast={forecast} />}
          {forecast && <MemoryLedgerPanel forecast={forecast} />}
          {action && <ActionOptions action={action} simulation={sim} selectedOption={state?.selected_option} onSelect={selectOption} eventId={activeEventId} />}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <SwarmFeed feed={feed} />
          <NLChat eventId={activeEventId} state={state} demoMode={demoMode} />
          {(statusKey === 'awaiting_hil' || statusKey === 'confirmed') && (
            <HILConfirm state={state} onConfirmed={onConfirmed} onAck={handleAck} />
          )}
        </div>
      </div>

      <footer style={{ padding: '14px 20px', borderTop: '1px solid var(--glass-border)', display: 'flex', gap: 14, alignItems: 'center', fontSize: 10 }} className="mono">
        <span style={{ color: 'var(--text-dim)' }}>DisruptIQ v2.0 · Supply Chain Intelligence</span>
        <span style={{ color: 'var(--text-dim)' }}>{statusInfo?.llm_live ? 'Live Analysis' : 'Demo Mode'}</span>
      </footer>

      <ReportDisruptionModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        onReportSuccess={(result) => {
          setActiveEventId(result.event_id)
          setState(result)
        }}
      />
    </>
  )
}
