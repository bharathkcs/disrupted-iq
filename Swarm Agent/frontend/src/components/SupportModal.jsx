import React, { useState } from 'react'
import { api } from '../services/api'

const CATEGORIES = [
  { label: "Can't log in",           icon: '🔐', sub: 'Access & auth' },
  { label: 'Supplier data issue',    icon: '🏭', sub: 'Upload or display' },
  { label: 'Simulation not working', icon: '🤖', sub: 'Run or results' },
  { label: 'News irrelevant',        icon: '📰', sub: 'Wrong industry' },
  { label: 'AI Q&A not helpful',     icon: '💬', sub: 'Assistant answers' },
  { label: 'Dashboard data missing', icon: '📊', sub: 'Blank panels' },
  { label: 'Account / billing',      icon: '💳', sub: 'Plan or payment' },
  { label: 'Delete my account',      icon: '🗑️', sub: 'Account removal' },
  { label: 'Something else',         icon: '🔧', sub: 'Other issues' },
]

const PRIORITY = [
  { value: 'Low',    icon: '🟢', color: '#10b981', desc: 'No rush' },
  { value: 'Normal', icon: '🟡', color: '#f59e0b', desc: 'Affects work' },
  { value: 'Urgent', icon: '🔴', color: '#ef4444', desc: 'Blocking me' },
]

export default function SupportModal({ isOpen, onClose }) {
  const [category, setCategory] = useState('')
  const [priority, setPriority] = useState('Normal')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [ticketId, setTicketId] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => { setCategory(''); setPriority('Normal'); setDescription(''); setError(null); setTicketId(null) }

  const handleSubmit = async () => {
    if (!category) { setError('Please select a category'); return }
    if (description.trim().length < 20) { setError('Description must be at least 20 characters'); return }
    setSubmitting(true); setError(null)
    try {
      const result = await api.submitSupportRequest({ category, priority, description })
      setTicketId(result.ticket_id)
      setTimeout(() => { onClose(); reset() }, 3500)
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally { setSubmitting(false) }
  }

  if (!isOpen) return null

  const charPct = Math.min(100, (description.length / 20) * 100)
  const charOk = description.length >= 20

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.8)',
      backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto',
        borderRadius: 20,
        background: 'linear-gradient(160deg, rgba(13,18,42,0.99) 0%, rgba(7,10,26,0.99) 100%)',
        border: '1px solid rgba(124,107,255,0.3)',
        boxShadow: '0 28px 70px rgba(0,0,0,0.75), 0 0 0 1px rgba(124,107,255,0.08), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}>

        {/* Header */}
        <div style={{
          padding: '20px 22px 18px',
          background: 'linear-gradient(135deg, rgba(124,107,255,0.1) 0%, rgba(45,212,191,0.05) 100%)',
          borderBottom: '1px solid rgba(124,107,255,0.15)',
          borderRadius: '20px 20px 0 0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{
              width: 44, height: 44, borderRadius: 13,
              background: 'linear-gradient(135deg, #7c6bff 0%, #2dd4bf 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, boxShadow: '0 0 22px rgba(124,107,255,0.5)',
            }}>🎧</div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>Support Request</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>We respond within 24 hours · Ticket auto-assigned</div>
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 9,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s',
          }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 22px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>

          {ticketId ? (
            <div style={{
              padding: '36px 24px', textAlign: 'center',
              background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.22)', borderRadius: 16,
            }}>
              <div style={{ fontSize: 44, marginBottom: 14 }}>🎉</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#10b981', marginBottom: 8 }}>Ticket Submitted!</div>
              <div style={{
                display: 'inline-block', fontSize: 12, fontWeight: 800, color: '#10b981',
                background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)',
                padding: '5px 16px', borderRadius: 20, marginBottom: 14, letterSpacing: '0.05em',
              }}>{ticketId}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
                Our team will reach out to your registered email.<br />Closing in a moment…
              </div>
            </div>
          ) : (
            <>
              {error && (
                <div style={{
                  padding: '10px 14px', borderRadius: 10,
                  background: 'rgba(239,68,68,0.09)', border: '1px solid rgba(239,68,68,0.28)',
                  fontSize: 12, color: '#f87171', display: 'flex', gap: 8, alignItems: 'center',
                }}>⚠️ {error}</div>
              )}

              {/* Category grid */}
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(255,255,255,0.32)', letterSpacing: '0.1em', marginBottom: 11 }}>
                  WHAT'S THE ISSUE? <span style={{ color: '#ef4444' }}>*</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {CATEGORIES.map(cat => {
                    const sel = category === cat.label
                    return (
                      <button key={cat.label} onClick={() => { setCategory(cat.label); setError(null) }} style={{
                        padding: '11px 8px', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
                        background: sel ? 'rgba(124,107,255,0.18)' : 'rgba(255,255,255,0.035)',
                        border: `1px solid ${sel ? 'rgba(124,107,255,0.5)' : 'rgba(255,255,255,0.07)'}`,
                        boxShadow: sel ? '0 0 14px rgba(124,107,255,0.28), inset 0 1px 0 rgba(196,184,255,0.1)' : 'none',
                        transition: 'all 0.16s ease',
                      }}>
                        <div style={{ fontSize: 20, marginBottom: 5, filter: sel ? 'drop-shadow(0 0 6px rgba(124,107,255,0.6))' : 'none' }}>{cat.icon}</div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: sel ? '#c4b8ff' : 'rgba(255,255,255,0.6)', lineHeight: 1.35, marginBottom: 2 }}>{cat.label}</div>
                        <div style={{ fontSize: 9, color: sel ? 'rgba(196,184,255,0.55)' : 'rgba(255,255,255,0.25)' }}>{cat.sub}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Priority */}
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(255,255,255,0.32)', letterSpacing: '0.1em', marginBottom: 11 }}>SEVERITY LEVEL</div>
                <div style={{ display: 'flex', gap: 9 }}>
                  {PRIORITY.map(p => {
                    const sel = priority === p.value
                    return (
                      <button key={p.value} onClick={() => setPriority(p.value)} style={{
                        flex: 1, padding: '12px 8px', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
                        background: sel ? `${p.color}14` : 'rgba(255,255,255,0.035)',
                        border: `1px solid ${sel ? p.color + '45' : 'rgba(255,255,255,0.07)'}`,
                        boxShadow: sel ? `0 0 14px ${p.color}25` : 'none',
                        transition: 'all 0.16s ease',
                      }}>
                        <div style={{ fontSize: 20, marginBottom: 5 }}>{p.icon}</div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: sel ? p.color : 'rgba(255,255,255,0.5)' }}>{p.value}</div>
                        <div style={{ fontSize: 9.5, color: sel ? `${p.color}99` : 'rgba(255,255,255,0.25)', marginTop: 3 }}>{p.desc}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Description */}
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(255,255,255,0.32)', letterSpacing: '0.1em', marginBottom: 11 }}>
                  DESCRIBE THE ISSUE <span style={{ color: '#ef4444' }}>*</span>
                </div>
                <textarea
                  value={description}
                  onChange={e => { setDescription(e.target.value); setError(null) }}
                  placeholder="What's happening? Include steps to reproduce, what you expected vs. what you saw…"
                  style={{
                    width: '100%', height: 112, padding: '12px 14px', boxSizing: 'border-box',
                    background: 'rgba(255,255,255,0.04)', resize: 'vertical',
                    border: `1px solid ${charOk ? 'rgba(16,185,129,0.38)' : 'rgba(255,255,255,0.09)'}`,
                    borderRadius: 12, color: '#fff', fontSize: 13, fontFamily: 'inherit',
                    outline: 'none', lineHeight: 1.6,
                    transition: 'border-color 0.2s',
                  }}
                />
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${charPct}%`,
                      background: charOk ? 'linear-gradient(90deg,#10b981,#2dd4bf)' : 'linear-gradient(90deg,#f59e0b,#fbbf24)',
                      borderRadius: 4, transition: 'width 0.2s, background 0.3s',
                    }} />
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: charOk ? '#10b981' : 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap' }}>
                    {description.length} / 20 min
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={onClose} style={{
                  flex: 1, padding: '13px', borderRadius: 12, cursor: 'pointer',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 600,
                  transition: 'all 0.15s',
                }}>Cancel</button>
                <button onClick={handleSubmit} disabled={submitting} style={{
                  flex: 2, padding: '13px', borderRadius: 12, border: 'none',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  background: submitting ? 'rgba(124,107,255,0.45)' : 'linear-gradient(135deg,#7c6bff,#2dd4bf)',
                  color: '#fff', fontSize: 13, fontWeight: 800,
                  boxShadow: submitting ? 'none' : '0 0 22px rgba(124,107,255,0.45)',
                  transition: 'all 0.2s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                  {submitting
                    ? <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span> Submitting…</>
                    : <><span>🎫</span> Submit Ticket</>}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
