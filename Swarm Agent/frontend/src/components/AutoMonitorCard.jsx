import React, { useEffect, useState } from 'react'
import { api } from '../services/api.js'
import { InfoTooltip } from './ui.jsx'

/**
 * AutoMonitorCard — Section 1 of the Market Differentiation Sprint.
 *
 * Lets the user configure the proactive auto-monitor: enable/disable,
 * trigger threshold, cooldown, and shows which of their own supplier zones
 * the daemon is currently watching. Works identically for the demo client
 * (zones from seed data) and real clients (zones from uploaded suppliers).
 *
 * Empty state: when the client has no suppliers, the zone list shows a
 * help message instead of pretending to monitor nothing.
 */
export default function AutoMonitorCard() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    api.getMonitorConfig()
      .then(res => { if (alive) setConfig(res) })
      .catch(err => { if (alive) setError(err?.message || 'Failed to load monitor config') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const save = async () => {
    if (!config) return
    setSaving(true)
    setError(null)
    try {
      const res = await api.updateMonitorConfig({
        auto_trigger_enabled: !!config.auto_trigger_enabled,
        threshold: Number(config.auto_trigger_threshold),
        cooldown_hours: Number(config.cooldown_hours),
      })
      setConfig({ ...config, ...res })
      setSavedAt(new Date())
    } catch (e) {
      setError(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="panel panel-pad">
        <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>Loading auto-monitor settings…</div>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="panel panel-pad">
        <div style={{ color: 'var(--danger)', fontSize: 13 }}>
          {error || 'Auto-monitor settings unavailable.'}
        </div>
      </div>
    )
  }

  const zones = Array.isArray(config.monitored_zones) ? config.monitored_zones : []
  const enabled = !!config.auto_trigger_enabled
  const threshold = Number(config.auto_trigger_threshold || 7)
  const cooldown = Number(config.cooldown_hours || 6)

  return (
    <div className="panel" style={{
      background: enabled
        ? 'linear-gradient(135deg, rgba(45,212,191,0.08), rgba(16,185,129,0.04))'
        : 'linear-gradient(135deg, rgba(107,114,128,0.06), rgba(75,85,99,0.02))',
      border: enabled
        ? '1px solid rgba(45,212,191,0.2)'
        : '1px solid rgba(148,163,184,0.15)',
    }}>
      <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🛰️</span>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-pri)' }}>Auto-Monitoring</span>
            <InfoTooltip
              title="Proactive disruption detection"
              description={
                'DisruptIQ continuously scans news and weather for your supplier zones. '
                + 'When a signal exceeds your threshold, the 9-agent swarm fires automatically — '
                + 'no manual trigger needed. Cooldown prevents alert spam from repeating news.'
              }
            />
          </div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: enabled ? 'var(--success)' : 'var(--text-dim)',
              background: enabled ? 'rgba(45,212,191,0.15)' : 'rgba(148,163,184,0.12)',
              border: `1px solid ${enabled ? 'rgba(45,212,191,0.4)' : 'rgba(148,163,184,0.3)'}`,
              padding: '4px 12px',
              borderRadius: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {enabled ? '🟢 Active' : '⚪ Paused'}
          </span>
        </div>

        <label style={rowStyle}>
        <span style={labelStyle}>Auto-monitoring</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => setConfig({ ...config, auto_trigger_enabled: e.target.checked })}
        />
        <span style={hintStyle}>
          {enabled ? 'Swarm fires automatically on qualifying signals.' : 'You will trigger swarms manually.'}
        </span>
      </label>

      <label style={rowStyle}>
        <span style={labelStyle}>Trigger threshold</span>
        <input
          type="range"
          min={3}
          max={10}
          step={0.5}
          value={threshold}
          onChange={e => setConfig({ ...config, auto_trigger_threshold: parseFloat(e.target.value) })}
          style={{ flex: 1, maxWidth: 220 }}
        />
        <span style={{ ...hintStyle, color: 'var(--text-pri)', minWidth: 70 }}>
          severity ≥ <strong>{threshold}</strong>/10
        </span>
      </label>

      <label style={rowStyle}>
        <span style={labelStyle}>Cooldown</span>
        <select
          value={cooldown}
          onChange={e => setConfig({ ...config, cooldown_hours: parseInt(e.target.value, 10) })}
          style={{ padding: '6px 8px', borderRadius: 6 }}
        >
          {[1, 2, 4, 6, 12, 24].map(h => (
            <option key={h} value={h}>{h}h</option>
          ))}
        </select>
        <span style={hintStyle}>Minimum hours between auto-triggers for the same zone.</span>
      </label>

      <div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Monitored zones ({zones.length})
        </div>
        {zones.length === 0 ? (
          <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(124,107,255,0.07)', border: '1px solid rgba(124,107,255,0.2)', color: 'var(--text-sec)', fontSize: 13, lineHeight: 1.5 }}>
            Upload suppliers to activate monitoring. The daemon watches the zones where your suppliers operate.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {zones.map(z => (
              <span key={z} style={zoneBadge}>{z}</span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: '10px 20px',
            borderRadius: 10,
            background: saving ? 'rgba(124,107,255,0.4)' : 'linear-gradient(135deg, var(--primary), #2dd4bf)',
            color: '#fff',
            border: 'none',
            fontSize: 13,
            fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer',
            transition: 'all 0.3s ease',
            boxShadow: saving ? 'none' : '0 4px 16px rgba(124,107,255,0.3)',
          }}
        >
          {saving ? '⏳ Saving…' : '💾 Save monitoring settings'}
        </button>
        {savedAt && !saving && (
          <span style={{ fontSize: 12, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 4 }}>
            ✓ Saved {savedAt.toLocaleTimeString()}
          </span>
        )}
        {error && <span style={{ fontSize: 12, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 4 }}>✕ {error}</span>}
      </div>
      </div>
    </div>
  )
}

const rowStyle = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }
const labelStyle = { minWidth: 140, fontSize: 13, color: 'var(--text-pri)', fontWeight: 600 }
const hintStyle = { fontSize: 12, color: 'var(--text-dim)' }
const zoneBadge = {
  fontSize: 12,
  padding: '4px 10px',
  borderRadius: 12,
  background: 'rgba(124,107,255,0.1)',
  border: '1px solid rgba(124,107,255,0.3)',
  color: 'var(--text-pri)',
}
