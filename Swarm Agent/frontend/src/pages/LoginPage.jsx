import React, { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../services/api'
import { authHelpers } from '../services/auth.js'

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleLogin = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await api.login({ email, password, remember_me: rememberMe })
      authHelpers.saveAuth(res.client_id, res.company_name, res.email, res.token)
      const returnUrl = searchParams.get('returnUrl')
      navigate(returnUrl || `/dashboard/${res.client_id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '12px 14px',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10, color: '#fff', fontSize: 14, outline: 'none', transition: 'all .2s',
  }

  return (
    <div style={{
      position: 'relative', minHeight: '100vh', width: '100%', overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      background: 'radial-gradient(ellipse 80% 60% at 50% -10%, #251f4d 0%, #0e0c1a 55%, #08070f 100%)',
      fontFamily: 'Segoe UI, Roboto, Helvetica, Arial, sans-serif',
    }}>
      {/* animated decorative orbs */}
      <div className="lp-orb" style={{ top: '-120px', left: '-80px', background: 'radial-gradient(circle,#7c6bff,transparent 70%)' }} />
      <div className="lp-orb lp-orb-2" style={{ bottom: '-140px', right: '-100px', background: 'radial-gradient(circle,#2dd4bf,transparent 70%)' }} />
      <div className="lp-orb lp-orb-3" style={{ top: '40%', left: '60%', background: 'radial-gradient(circle,#a855f7,transparent 70%)' }} />

      <div className="lp-card" style={{
        position: 'relative', zIndex: 2, width: '100%', maxWidth: 420,
        background: 'rgba(20,18,32,0.72)', backdropFilter: 'blur(18px)',
        border: '1px solid rgba(124,107,255,0.25)', borderRadius: 20,
        padding: '38px 34px', boxShadow: '0 24px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}>
        {/* brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 26 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg,#7c6bff,#2dd4bf)', color: '#fff', fontWeight: 800, fontSize: 20,
            boxShadow: '0 6px 18px rgba(124,107,255,0.5)',
          }}>D</div>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 18, letterSpacing: 0.3 }}>
            Disrupt<span style={{ color: '#2dd4bf' }}>IQ</span>
          </span>
        </div>

        <h1 style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 800, color: '#fff', letterSpacing: 0.2 }}>Welcome back</h1>
        <p style={{ margin: '0 0 24px', fontSize: 13.5, color: 'rgba(255,255,255,0.55)' }}>Sign in to your DisruptIQ account</p>

        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)',
            color: '#fca5a5', padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 18,
          }}>⚠ {error}</div>
        )}

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 7 }}>Email address</label>
            <input
              className="lp-input" type="email" value={email}
              onChange={(e) => setEmail(e.target.value.toLowerCase())}
              placeholder="your@company.com" required style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 7 }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                className="lp-input" type={showPw ? 'text' : 'password'} value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password" required style={{ ...inputStyle, paddingRight: 64 }}
              />
              <button
                type="button" onClick={() => setShowPw(s => !s)}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.55)',
                  fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: '4px 8px',
                }}
              >{showPw ? 'Hide' : 'Show'}</button>
            </div>
          </div>

          {/* checkbox row — checkbox left, forgot-password right, vertically aligned */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '6px 0 22px' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.7)', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: '#7c6bff', cursor: 'pointer', margin: 0, flexShrink: 0 }}
              />
              Remember me
            </label>
            <a href="/forgot-password" style={{ fontSize: 12.5, color: '#a78bfa', textDecoration: 'none', fontWeight: 600 }}>Forgot password?</a>
          </div>

          <button
            type="submit" disabled={loading} className="lp-btn"
            style={{
              width: '100%', padding: '13px', border: 'none', borderRadius: 10,
              background: 'linear-gradient(135deg,#7c6bff,#2dd4bf)', color: '#fff',
              fontSize: 15, fontWeight: 700, cursor: loading ? 'wait' : 'pointer',
              opacity: loading ? 0.75 : 1, boxShadow: '0 8px 24px rgba(124,107,255,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}
          >
            {loading && <span className="lp-spin" style={{ width: 15, height: 15, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block' }} />}
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 22, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
          Don't have an account? <a href="/signup-register" style={{ color: '#2dd4bf', textDecoration: 'none', fontWeight: 600 }}>Create one now</a>
        </p>
        <p style={{ textAlign: 'center', marginTop: 8, fontSize: 12.5, color: 'rgba(255,255,255,0.4)' }}>
          Want to see how it works? <a href="/demo" style={{ color: '#a78bfa', textDecoration: 'none' }}>Try the demo</a>
        </p>
      </div>

      <style>{`
        .lp-orb { position: absolute; width: 360px; height: 360px; border-radius: 50%;
          filter: blur(40px); opacity: 0.5; z-index: 0; animation: lp-float 11s ease-in-out infinite; }
        .lp-orb-2 { animation-duration: 14s; opacity: 0.4; }
        .lp-orb-3 { width: 260px; height: 260px; opacity: 0.28; animation-duration: 17s; }
        @keyframes lp-float { 0%,100% { transform: translate(0,0); } 50% { transform: translate(26px,-30px); } }
        .lp-card { animation: lp-rise .55s cubic-bezier(.2,.8,.2,1) both; }
        @keyframes lp-rise { from { opacity: 0; transform: translateY(22px) scale(.98); } to { opacity: 1; transform: none; } }
        .lp-input:focus { border-color: #7c6bff !important; background: rgba(124,107,255,0.08) !important;
          box-shadow: 0 0 0 3px rgba(124,107,255,0.18); }
        .lp-input::placeholder { color: rgba(255,255,255,0.32); }
        .lp-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 30px rgba(124,107,255,0.55); }
        .lp-btn { transition: transform .15s, box-shadow .15s; }
        .lp-spin { animation: lp-rot .7s linear infinite; }
        @keyframes lp-rot { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
