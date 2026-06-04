import React, { useEffect, useRef, useState } from 'react'
import { PanelHeader, InfoTooltip } from './ui.jsx'

function FeedRow({ entry }) {
  const [open, setOpen] = useState(false)
  const hasPayload = entry.payload && Object.keys(entry.payload).length > 0
  const t = entry.timestamp_utc?.split('T')[1]?.slice(0, 8) || ''

  const statusColors = {
    activating: 'var(--warning)',
    complete: 'var(--success)',
    failed: 'var(--danger)',
    dissent_detected: 'var(--purple)',
    hil_ready: 'var(--primary)',
    answered: 'var(--info)',
    recalling: 'var(--info)',
    confirmed: 'var(--success)',
    classified: 'var(--pink)',
  }
  const c = statusColors[entry.status] || 'var(--text-dim)'

  const agentShortNames = {
    MonitorAgent: 'Monitor',
    ForecastAgent: 'Forecast',
    RiskAgent: 'Risk',
    ActionAgent: 'Action',
    ValidatorAgent: 'Validator',
    SimulationAgent: 'Simulation',
    CascadeDetectionAgent: 'Cascade',
    CounterfactualAgent: 'Counterfactual',
    SwarmMemory: 'Memory',
    NLInterrogation: 'AI Chat',
    Orchestrator: 'Coordinator',
    HIL: 'User',
  }

  const statusLabels = {
    activating: 'Starting',
    complete: 'Done',
    recalling: 'Searching memory',
    dissent_detected: 'Agents disagree',
    hil_ready: 'Ready for review',
    confirmed: 'Confirmed',
    classified: 'Classified',
    answered: 'Answered',
    failed: 'Failed',
  }

  const displayName = agentShortNames[entry.agent] || entry.agent
  const displayStatus = statusLabels[entry.status] || entry.status

  return (
    <div
      className="slide-up"
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        marginBottom: 4,
        background: open ? 'rgba(255,255,255,0.04)' : 'transparent',
        cursor: hasPayload ? 'pointer' : 'default',
        transition: 'background 0.15s',
      }}
      onClick={() => hasPayload && setOpen(o => !o)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          className={entry.status === 'activating' ? 'blink' : ''}
          style={{ width: 7, height: 7, borderRadius: '50%', background: c, flexShrink: 0, boxShadow: `0 0 8px ${c}` }}
        />
        <span style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-pri)', flex: 1 }}>
          {displayName}
        </span>
        <span style={{ fontSize: 11, color: c, fontWeight: 500 }}>{displayStatus}</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{t}</span>
        {hasPayload && (
          <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>{open ? '▾' : '▸'}</span>
        )}
      </div>
      {open && hasPayload && (
        <div style={{
          marginTop: 8, padding: '8px 12px',
          background: 'rgba(0,0,0,0.2)', borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          {Object.entries(entry.payload).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 10, marginBottom: 3 }}>
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', minWidth: 120 }}>{k}</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-sec)' }}>
                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function SwarmFeed({ feed }) {
  const ref = useRef(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (!collapsed && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [feed, collapsed])

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: collapsed ? 'auto' : 400, overflow: 'hidden' }}>
      <PanelHeader
        label="Live Activity Feed"
        accent="var(--primary)"
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="live-dot" />
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-sec)' }}>
              {feed.length} updates
            </span>
            <InfoTooltip
              title="Live Agent Activity"
              description="Shows the real-time actions of the 9 AI agents as they analyse your disruption event. Each agent reports its status — activating, processing, complete — so you can follow exactly what the system is doing and why."
            />
          </div>
        }
      />
      {!collapsed && (
        <div ref={ref} style={{ flex: 1, overflowY: 'auto', padding: 12, minHeight: 0 }}>
          {feed.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 16px' }}>
              <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.55 }}>📡</div>
              <p style={{ fontSize: 12.5, color: 'var(--text-sec)', fontWeight: 500 }}>
                Waiting for analysis to begin
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                Report a disruption to watch the team work in real time
              </p>
            </div>
          ) : (
            feed.map((e, i) => <FeedRow key={i} entry={e} />)
          )}
        </div>
      )}
    </div>
  )
}
