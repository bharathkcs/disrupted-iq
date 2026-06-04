import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../services/api'
import './LoginPage.css'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [passwordStrength, setPasswordStrength] = useState(0)
  const [tokenValid, setTokenValid] = useState(false)
  const [verifyingToken, setVerifyingToken] = useState(true)

  const checkPasswordStrength = (pwd) => {
    let strength = 0
    if (pwd.length >= 8) strength++
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) strength++
    if (/\d/.test(pwd)) strength++
    if (/[!@#$%^&*]/.test(pwd)) strength++
    return strength
  }

  const handleNewPasswordChange = (e) => {
    const pwd = e.target.value
    setNewPassword(pwd)
    setPasswordStrength(checkPasswordStrength(pwd))
  }

  useEffect(() => {
    if (!token) {
      setVerifyingToken(false)
      return
    }
    api.verifyResetToken({ token })
      .then((res) => {
        setTokenValid(!!res.valid)
        if (!res.valid) setError('This reset link is invalid or has expired.')
      })
      .catch(() => {
        setTokenValid(false)
        setError('This reset link is invalid or has expired.')
      })
      .finally(() => setVerifyingToken(false))
  }, [token])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    if (!token || !tokenValid) {
      setError('Invalid or missing reset token')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      const res = await api.resetPassword({
        token,
        new_password: newPassword,
        confirm_password: confirmPassword,
      })
      setSuccess(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (verifyingToken) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div style={{ textAlign: 'center', color: 'var(--text-sec)' }}>
            <h1>Checking Reset Link</h1>
            <p>Verifying your password reset request…</p>
          </div>
        </div>
      </div>
    )
  }

  if (!token || !tokenValid) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div style={{ textAlign: 'center', color: 'var(--danger)' }}>
            <h1>Invalid Reset Link</h1>
            <p>The password reset link is missing or invalid.</p>
            <p style={{ marginTop: '20px' }}>
              <a href="/forgot-password" className="btn btn-primary">
                Request a new reset link
              </a>
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✓</div>
            <h1 style={{ color: 'var(--success)', marginBottom: '12px' }}>Password Reset</h1>
            <p>Your password has been successfully reset.</p>
            <p style={{ color: 'var(--text-sec)', marginTop: '16px', marginBottom: '24px' }}>
              Redirecting to login in 3 seconds...
            </p>
            <button onClick={() => navigate('/login')} className="btn btn-primary">
              Go to Login Now
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>Set New Password</h1>
          <p>Enter a strong password for your account</p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={handleNewPasswordChange}
              placeholder="Enter new password"
              required
            />
            {newPassword && (
              <div style={{ marginTop: '8px', fontSize: '12px' }}>
                <div style={{
                  height: '4px',
                  background: '#e5e7eb',
                  borderRadius: '2px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%',
                    width: `${(passwordStrength / 4) * 100}%`,
                    background: passwordStrength <= 1 ? '#ef4444' : passwordStrength <= 2 ? '#f59e0b' : passwordStrength <= 3 ? '#3b82f6' : '#10b981',
                    transition: 'width 0.3s'
                  }} />
                </div>
                <div style={{ color: 'var(--text-sec)', marginTop: '4px' }}>
                  Requirements:
                  <ul style={{ margin: '6px 0 0 20px', fontSize: '11px' }}>
                    <li style={{ color: newPassword.length >= 8 ? 'var(--success)' : 'inherit' }}>✓ At least 8 characters</li>
                    <li style={{ color: /[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword) ? 'var(--success)' : 'inherit' }}>✓ Upper and lowercase letters</li>
                    <li style={{ color: /\d/.test(newPassword) ? 'var(--success)' : 'inherit' }}>✓ At least one number</li>
                    <li style={{ color: /[!@#$%^&*]/.test(newPassword) ? 'var(--success)' : 'inherit' }}>✓ One special character (!@#$%^&*)</li>
                  </ul>
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              required
            />
            {confirmPassword && newPassword !== confirmPassword && (
              <div style={{ marginTop: '6px', color: 'var(--danger)', fontSize: '12px' }}>
                Passwords do not match
              </div>
            )}
          </div>

          <button type="submit" className="btn btn-primary btn-lg" disabled={loading || passwordStrength < 4}>
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>

        <p className="or-demo" style={{ marginTop: '20px' }}>
          <a href="/login">Back to login</a>
        </p>
      </div>
    </div>
  )
}
