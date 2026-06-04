import React, { useState, useEffect } from 'react'
import { api } from '../services/api'

// Detects whether an error/response message is about the free-plan supplier limit.
export function isLimitMessage(message) {
  if (!message) return false
  const m = String(message)
  return (
    m.includes('Premium') ||
    m.includes('premium') ||
    m.includes('kcsbadp') ||
    m.includes('free-plan') ||
    m.includes('free plan') ||
    m.includes('slot') ||
    m.includes('limit of 30') ||
    m.includes('30-supplier') ||
    m.includes('30 supplier')
  )
}

// Popup shown when a user hits the free-plan supplier cap. Lets the user submit
// a Premium access request that an owner approves in the Admin Console.
export default function UpgradeModal({ open, message, onClose }) {
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null) // { status, message }
  const [error, setError] = useState(null)

  useEffect(() => {
    if (open) { setSending(false); setResult(null); setError(null) }
  }, [open])

  if (!open) return null

  const submit = async () => {
    setSending(true); setError(null)
    try {
      const res = await api.requestPremium()
      setResult({ status: res.status || 'pending', message: res.message || 'Request sent.' })
    } catch (err) {
      setError(err.message || 'Could not send request. Please try again.')
    } finally {
      setSending(false)
    }
  }

  const done = result && (result.status === 'pending' || result.status === 'approved')

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(6,8,15,0.78)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: 480, width: '100%',
          background: 'linear-gradient(160deg, #1b1733, #131120)',
          border: '1px solid rgba(124,107,255,0.45)', borderRadius: 16,
          padding: 30, boxShadow: '0 24px 70px rgba(0,0,0,0.65)', position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute', top: 14, right: 16, background: 'transparent',
            border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 22, cursor: 'pointer', lineHeight: 1,
          }}
        >
          ×
        </button>

        <div style={{
          width: 56, height: 56, borderRadius: 14,
          background: done ? 'linear-gradient(135deg,#10b981,#2dd4bf)' : 'linear-gradient(135deg,#7c6bff,#2dd4bf)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, marginBottom: 16,
        }}>
          {done ? '✓' : '🔒'}
        </div>

        <div style={{ fontWeight: 800, fontSize: 20, color: '#fff', marginBottom: 10, letterSpacing: 0.2 }}>
          {done ? 'Request Sent' : 'Free Plan Limit Reached'}
        </div>

        {done ? (
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', lineHeight: 1.7, marginBottom: 20 }}>
            {result.status === 'approved'
              ? 'Your account already has Premium access — you can add suppliers beyond the free limit.'
              : 'Your Premium access request has been sent to our team. Once an administrator approves it, you’ll be able to add more than 30 suppliers. You’ll get a notification when it’s reviewed.'}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.72)', lineHeight: 1.7, marginBottom: 8 }}>
              Your free account supports up to <strong style={{ color: '#fff' }}>30 suppliers</strong>.
              If you upload more, only the first 30 are kept — any beyond that are not imported.
            </div>
            {message && (
              <div style={{
                fontSize: 12.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6,
                background: 'rgba(124,107,255,0.08)', border: '1px solid rgba(124,107,255,0.18)',
                borderRadius: 8, padding: '10px 12px', margin: '12px 0',
              }}>
                {message}
              </div>
            )}
            <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.72)', lineHeight: 1.7, marginBottom: 20 }}>
              To add <strong style={{ color: '#a78bfa' }}>more than 30 suppliers</strong>, request
              {' '}<strong style={{ color: '#a78bfa' }}>Premium access</strong>. An administrator will review and approve it.
            </div>
          </>
        )}

        {error && (
          <div style={{ fontSize: 12.5, color: '#fca5a5', marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {!done && (
            <button
              onClick={submit}
              disabled={sending}
              style={{
                padding: '10px 20px', border: 'none',
                background: 'linear-gradient(135deg,#7c6bff,#2dd4bf)',
                borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: sending ? 'wait' : 'pointer', opacity: sending ? 0.7 : 1,
                boxShadow: '0 4px 16px rgba(124,107,255,0.4)',
              }}
            >
              {sending ? 'Sending…' : '★ Request Premium Access'}
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '10px 18px', background: 'transparent',
              border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8,
              color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {done ? 'Close' : 'Maybe later'}
          </button>
        </div>
      </div>
    </div>
  )
}
