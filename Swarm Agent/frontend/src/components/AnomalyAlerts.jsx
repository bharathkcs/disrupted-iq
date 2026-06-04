import React, { useEffect, useState } from 'react'
import { api } from '../services/api.js'
import { InfoTooltip } from './ui.jsx'

export default function AnomalyAlerts() {
  const [data, setData] = useState(null)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const load = () => api.supplierAnomalies().then(setData).catch(() => {})
    load()
    const timer = setInterval(load, 300000)
    return () => clearInterval(timer)
  }, [])

  if (!data) return null

  const hasAnomalies = data.total_anomalies > 0

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div
        className="panel-header"
        onClick={() => setIsOpen(!isOpen)}
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-pri)' }}>Supplier Anomalies</span>
          <span onClick={e => e.stopPropagation()}>
            <InfoTooltip
              title="Supplier Anomaly Alerts"
              description="Statistical outlier detection across your supplier portfolio. Flags suppliers whose buffer stock, reliability, or proximity score has deviated significantly from normal — an early warning before a supplier failure becomes critical."
            />
          </span>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 24,
              height: 24,
              borderRadius: '50%',
              background: hasAnomalies ? 'rgba(255, 107, 107, 0.2)' : 'rgba(45, 212, 191, 0.2)',
              color: hasAnomalies ? 'var(--danger)' : 'var(--success)',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {data.total_anomalies}
          </div>
        </div>
        <span style={{ fontSize: 16, color: 'var(--text-dim)' }}>{isOpen ? '▼' : '▶'}</span>
      </div>

      {isOpen && (
        <div style={{ padding: 16 }}>
          {hasAnomalies ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {data.anomalies.map((anomaly, idx) => (
                <div
                  key={idx}
                  style={{
                    borderLeft: `4px solid ${anomaly.severity === 'critical' ? 'var(--danger)' : 'var(--warning)'}`,
                    paddingLeft: 12,
                    paddingTop: 8,
                    paddingBottom: 8,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-pri)', marginBottom: 2 }}>
                    {anomaly.supplier_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-sec)', marginBottom: 4 }}>
                    {anomaly.description}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                    ➜ {anomaly.recommended_action}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--success)', textAlign: 'center', padding: '12px 0' }}>
              ✓ All suppliers healthy
            </div>
          )}
        </div>
      )}
    </div>
  )
}
