import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import './LoginPage.css'

export default function ForgotPassword() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await api.forgotPassword({ email })
      setSubmitted(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <h1>Check Your Email</h1>
            <p>Password reset instructions have been sent</p>
          </div>

          <div style={{
            background: 'rgba(34, 197, 94, 0.1)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            borderRadius: '8px',
            padding: '20px',
            marginBottom: '20px',
            textAlign: 'center'
          }}>
            <p style={{ marginBottom: '10px', fontSize: '14px', lineHeight: '1.6' }}>
              We've sent a password reset link to <strong>{email}</strong>.
              Check your email and click the link to reset your password.
            </p>
            <p style={{ fontSize: '12px', color: 'var(--text-sec)' }}>
              The link will expire in 1 hour for security reasons.
            </p>
          </div>

          <p style={{ fontSize: '12px', color: 'var(--text-sec)', marginBottom: '20px' }}>
            Didn't receive an email? Check your spam folder or try again.
          </p>

          <button
            onClick={() => setSubmitted(false)}
            className="btn btn-secondary btn-lg"
            style={{ width: '100%' }}
          >
            Try a different email
          </button>

          <p style={{ textAlign: 'center', marginTop: '20px' }}>
            <a href="/login" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
              Back to login
            </a>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>Reset Password</h1>
          <p>Enter your email to receive a reset link</p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value.toLowerCase())}
              placeholder="your@company.com"
              required
            />
          </div>

          <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
            {loading ? 'Sending reset link...' : 'Send Reset Link'}
          </button>
        </form>

        <p className="back-to-login">
          <a href="/login">Back to login</a>
        </p>
      </div>
    </div>
  )
}
