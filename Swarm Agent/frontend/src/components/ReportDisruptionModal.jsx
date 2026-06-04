import React, { useState } from 'react'
import { api } from '../services/api.js'

export default function ReportDisruptionModal({ isOpen, onClose, onReportSuccess }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [formData, setFormData] = useState({
    description: '',
    location: '',
    source: 'Manual',
    type: 'Disruption Event',
  })

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    if (!formData.description.trim() || !formData.location.trim()) {
      setError('Description and location are required')
      return
    }

    setLoading(true)
    try {
      const response = await api.triggerEvent(formData)
      onReportSuccess?.(response)
      setFormData({ description: '', location: '', source: 'Manual', type: 'Disruption Event' })
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to report disruption')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
    }}>
      <div style={{
        background: '#1a1f3a',
        border: '1px solid #2d3856',
        borderRadius: '12px',
        padding: '28px',
        maxWidth: '500px',
        width: '90%',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)',
      }}>
        <h2 style={{ margin: '0 0 20px 0', color: '#fff', fontSize: '24px', fontWeight: '700' }}>
          📋 Report Disruption
        </h2>
        <p style={{ margin: '0 0 20px 0', color: '#9ca3af', fontSize: '14px' }}>
          Report a supply chain disruption event. Our analysis team will assess the impact and suggest actions.
        </p>

        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid #ef4444',
            color: '#fca5a5',
            padding: '12px',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '13px',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', color: '#d1d5db', marginBottom: '6px', fontSize: '13px', fontWeight: '600' }}>
              Description *
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="E.g., Port closure in Chennai due to cyclone warning"
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#111827',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '13px',
                fontFamily: 'inherit',
                minHeight: '80px',
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', color: '#d1d5db', marginBottom: '6px', fontSize: '13px', fontWeight: '600' }}>
              Location *
            </label>
            <input
              type="text"
              name="location"
              value={formData.location}
              onChange={handleChange}
              placeholder="E.g., Chennai Port, India"
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#111827',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '13px',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', color: '#d1d5db', marginBottom: '6px', fontSize: '13px', fontWeight: '600' }}>
                Source
              </label>
              <select
                name="source"
                value={formData.source}
                onChange={handleChange}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: '#111827',
                  border: '1px solid #374151',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '13px',
                  fontFamily: 'inherit',
                }}
              >
                <option value="Manual">Manual Report</option>
                <option value="NewsAPI">News Alert</option>
                <option value="Internal">Internal</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', color: '#d1d5db', marginBottom: '6px', fontSize: '13px', fontWeight: '600' }}>
                Type
              </label>
              <select
                name="type"
                value={formData.type}
                onChange={handleChange}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: '#111827',
                  border: '1px solid #374151',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '13px',
                  fontFamily: 'inherit',
                }}
              >
                <option value="Disruption Event">Disruption</option>
                <option value="Weather Event">Weather</option>
                <option value="Port Closure">Port Closure</option>
                <option value="Supplier Failure">Supplier Failure</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                flex: 1,
                padding: '10px 16px',
                background: '#374151',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                flex: 1,
                padding: '10px 16px',
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Reporting...' : 'Report Disruption'}
            </button>
          </div>
        </form>

        <p style={{ margin: '12px 0 0 0', color: '#6b7280', fontSize: '11px' }}>
          Your report will be analyzed by our swarm intelligence system within 90 seconds.
        </p>
      </div>
    </div>
  )
}
