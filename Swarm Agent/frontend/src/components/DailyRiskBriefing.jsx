import React, { useEffect, useState } from 'react'
import { api } from '../services/api'
import { InfoTooltip } from './ui'

/**
 * DailyRiskBriefing — proactive 0–100 disruption risk score derived from the
 * client's own zones, news, weather, and supplier reliability. Hidden when the
 * client has no suppliers (the API also returns score=0 in that case).
 *
 * Fetches /api/disruption-risk on mount and on each refreshKey change.
 */
export default function DailyRiskBriefing({ refreshKey }) {
  const [briefing, setBriefing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Section 7 Sprint - history modal state
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  const loadHistory = async () => {
    if (history) return
    setHistoryLoading(true)
    try {
      const res = await api.briefingHistory(14)
      setHistory(Array.isArray(res?.history) ? res.history : [])
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await api.getDisruptionRisk()
        if (!cancelled) setBriefing(data)
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load briefing')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  if (loading || error || !briefing) return null
  if (briefing.score === 0 && !briefing.zones?.length) return null

  const tier = briefing.tier || 'low'
  const tierColor =
    tier === 'high' ? '#FF6B6B' : tier === 'medium' ? '#F59E0B' : '#10B981'

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        background: 'rgba(15, 19, 36, 0.65)',
        border: `1px solid ${tierColor}40`,
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
          Daily Disruption Risk Briefing
        </span>
        <InfoTooltip
          title="What this means"
          description={
            'Proactive score 0-100 derived from your zones, recent news pulse, '
            + 'weather snapshot, and supplier reliability. Updated each session.'
          }
        />
        <button
          type="button"
          onClick={() => { setHistoryOpen(true); loadHistory() }}
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: 6,
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.18)',
            color: 'var(--accent)',
            cursor: 'pointer',
          }}
        >
          View 14-day history
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <span style={{ fontSize: 32, fontWeight: 800, color: tierColor }}>
          {briefing.score}
          <span style={{ fontSize: 16, color: 'var(--text-sec)', fontWeight: 600 }}>/100</span>
        </span>
        <span
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            background: `${tierColor}25`,
            color: tierColor,
            fontWeight: 700,
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          {tier} risk
        </span>
      </div>

      {historyOpen && (
        <HistoryModal
          history={history}
          loading={historyLoading}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {briefing.zones && briefing.zones.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {briefing.zones.slice(0, 6).map((z) => (
            <div
              key={z.zone}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 10px',
                borderRadius: 6,
                background: 'rgba(255,255,255,0.03)',
                fontSize: 12,
              }}
            >
              <span style={{ color: 'var(--text)' }}>
                <strong>{z.zone}</strong>
                <span style={{ color: 'var(--text-sec)', marginLeft: 6 }}>
                  · {z.suppliers_at_risk} supplier{z.suppliers_at_risk === 1 ? '' : 's'}
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--text-sec)', fontSize: 11 }}>
                  {z.news_mentions_24h > 0 && `${z.news_mentions_24h} news `}
                  {z.weather_severity > 0 && `· wx ${z.weather_severity}`}
                </span>
                <strong style={{ color: z.tier === 'high' ? '#FF6B6B' : z.tier === 'medium' ? '#F59E0B' : '#10B981' }}>
                  {z.score}
                </strong>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * HistoryModal — Section 7 Sprint. Shows the last 14 daily briefings with
 * an inline mini-sparkline so the user can see the trend at a glance.
 */
function HistoryModal({ history, loading, onClose }) {
  const items = history || []
  const maxScore = items.length ? Math.max(...items.map((h) => h.score || 0), 1) : 1

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9000, padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 100%)',
          maxHeight: '85vh',
          overflowY: 'auto',
          background: 'rgba(15,19,36,0.98)',
          border: '1px solid var(--glass-border)',
          borderRadius: 14,
          padding: 22,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            Disruption-Risk History (last 14 days)
          </span>
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-sec)', fontSize: 20, lineHeight: 1,
            }}
            aria-label="Close"
          >×</button>
        </div>

        {loading && <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>Loading history…</div>}

        {!loading && items.length === 0 && (
          <div style={{ color: 'var(--text-sec)', fontSize: 13, lineHeight: 1.55 }}>
            No history snapshots yet. The daily briefing background task captures one
            entry per day per client; check back tomorrow to see your first trend point.
          </div>
        )}

        {!loading && items.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 64, marginBottom: 16 }}>
              {[...items].reverse().map((h) => {
                const height = Math.max(4, Math.round((h.score / maxScore) * 60))
                const color = h.tier === 'high' ? '#FF6B6B' : h.tier === 'medium' ? '#F59E0B' : '#10B981'
                return (
                  <div
                    key={h.date}
                    title={`${h.date}: ${h.score}/100 (${h.tier})`}
                    style={{
                      flex: 1, height, background: color, borderRadius: '2px 2px 0 0', opacity: 0.85,
                    }}
                  />
                )
              })}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((h) => {
                const color = h.tier === 'high' ? '#FF6B6B' : h.tier === 'medium' ? '#F59E0B' : '#10B981'
                return (
                  <div key={h.date} style={{
                    display: 'flex', justifyContent: 'space-between',
                    padding: '8px 12px', borderRadius: 6,
                    background: 'rgba(255,255,255,0.03)',
                    fontSize: 12,
                  }}>
                    <span style={{ color: 'var(--text)' }}>
                      <strong>{h.date}</strong>
                      <span style={{ color: 'var(--text-sec)', marginLeft: 8 }}>
                        {h.zone_count} zone{h.zone_count === 1 ? '' : 's'} · {h.supplier_count} supplier{h.supplier_count === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span>
                      <span style={{ color: 'var(--text-sec)', marginRight: 8 }}>{h.tier}</span>
                      <strong style={{ color }}>{h.score}/100</strong>
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
