import React, { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom'
import { api } from './services/api.js'
import { authHelpers } from './services/auth.js'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import NotificationBell from './components/NotificationBell.jsx'
import SearchModal from './components/SearchModal.jsx'
import SupportModal from './components/SupportModal.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Reports from './pages/Reports.jsx'
import EventHistory from './pages/EventHistory.jsx'
import WeatherMonitor from './pages/WeatherMonitor.jsx'
import ConfigPage from './pages/Config.jsx'
import SupplyChainMap from './pages/SupplyChainMap.jsx'
import DependencyHeatmap from './pages/DependencyHeatmap.jsx'
import SupplierTrends from './pages/SupplierTrends.jsx'
import Landing from './pages/Landing.jsx'
import SignupRegister from './pages/SignupRegister.jsx'
import LoginPage from './pages/LoginPage.jsx'
import ForgotPassword from './pages/ForgotPassword.jsx'
import ResetPassword from './pages/ResetPassword.jsx'
import AccountSettings from './pages/AccountSettings.jsx'
import Admin from './pages/Admin.jsx'
import Tier2Visibility from './pages/Tier2Visibility.jsx'

// NAV_ITEMS use relative paths; AppHeader will prefix them with current dashboard base when present
const NAV_ITEMS = [
  { path: 'map',          label: 'Twin Map',      icon: '🗺️' },
  { path: 'dependencies', label: 'Dependencies',  icon: '🔗' },
  { path: 'tier2',        label: 'Tier-2',        icon: '🧬' },
  { path: 'trends',       label: 'Trends',        icon: '📈' },
  { path: 'reports',      label: 'Reports',       icon: '📋' },
  { path: 'history',      label: 'Event History', icon: '🕒' },
  { path: 'weather',      label: 'Weather',       icon: '🌤️' },
  { path: 'config',       label: 'Config',        icon: '⚙️' },
]

const STATUS_META = {
  confirmed:          { label: 'Confirmed',       color: '#10b981' },
  resolved:           { label: 'Resolved',        color: '#60a5fa' },
  awaiting_hil:       { label: 'Awaiting Review', color: '#f59e0b' },
  validation_failed:  { label: 'Check Failed',    color: '#ef4444' },
  below_threshold:    { label: 'No Action',       color: '#94a3b8' },
  escalated_to_human: { label: 'Escalated',       color: '#ef4444' },
}

function GlassBtn({ onClick, title, children }) {
  const [hov, setHov] = React.useState(false)
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        width: 36, height: 36, borderRadius: 10, cursor: 'pointer',
        background: hov
          ? 'linear-gradient(135deg,rgba(124,107,255,0.3),rgba(45,212,191,0.15))'
          : 'rgba(255,255,255,0.04)',
        border: `1px solid ${hov ? 'rgba(124,107,255,0.55)' : 'rgba(255,255,255,0.09)'}`,
        color: hov ? '#d4cfff' : 'rgba(255,255,255,0.42)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.2s ease',
        boxShadow: hov ? '0 0 16px rgba(124,107,255,0.4), inset 0 1px 0 rgba(255,255,255,0.1)' : 'none',
        backdropFilter: 'blur(8px)',
      }}>{children}</button>
  )
}

function AppHeader({ activeEventId, status, showDashboardNav = false, isLoggedIn = false, companyName = null, premium = false, onSearchOpen = null, onSupportOpen = null, demoMode = false }) {
  const navigate = useNavigate()
  const location = useLocation()
  const s = STATUS_META[status] || null
  const initials = companyName ? companyName.slice(0, 2).toUpperCase() : 'U'
  const handleLogout = () => { authHelpers.clearAuth(); navigate('/') }

  return (
    <header style={{
      height: 60, flexShrink: 0,
      position: 'sticky', top: 0, zIndex: 200,
      display: 'flex', alignItems: 'center',
      padding: '0 22px', gap: 0,
      background: 'rgba(4,6,18,0.92)',
      backdropFilter: 'blur(32px)',
      WebkitBackdropFilter: 'blur(32px)',
      borderBottom: '1px solid rgba(124,107,255,0.2)',
      boxShadow: '0 0 0 1px rgba(124,107,255,0.06), 0 8px 32px rgba(0,0,0,0.5)',
    }}>

      {/* Animated shimmer line at very top */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1,
        background: 'linear-gradient(90deg,transparent 0%,#7c6bff 30%,#2dd4bf 65%,transparent 100%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer-x 4s linear infinite',
        pointerEvents: 'none', opacity: 0.7,
      }} />

      {/* Radial glow from left (logo area) */}
      <div style={{
        position: 'absolute', left: -40, top: '50%', transform: 'translateY(-50%)',
        width: 220, height: 120,
        background: 'radial-gradient(ellipse,rgba(124,107,255,0.14) 0%,transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* ── Logo ── */}
      <div onClick={() => navigate('/')} style={{
        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        marginRight: 28, flexShrink: 0, position: 'relative',
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: 10, position: 'relative',
          background: 'linear-gradient(135deg,#7c6bff,#2dd4bf)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 900, color: '#fff',
          boxShadow: '0 0 0 1px rgba(124,107,255,0.4), 0 0 20px rgba(124,107,255,0.6)',
        }}>D</div>
        <span style={{
          fontWeight: 900, fontSize: 18, letterSpacing: '-0.04em',
          background: 'linear-gradient(90deg,#fff 0%,#c4b8ff 50%,#2dd4bf 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          backgroundSize: '200% 100%',
          animation: 'shimmer-x 6s linear infinite',
        }}>DisruptIQ</span>
        {premium && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '2px 8px', borderRadius: 20, marginLeft: 4,
            background: 'linear-gradient(135deg,rgba(250,204,21,0.25),rgba(251,146,60,0.15))',
            border: '1px solid rgba(250,204,21,0.5)',
            fontSize: 9, fontWeight: 900, color: '#fcd34d', letterSpacing: '0.1em',
            boxShadow: '0 0 10px rgba(250,204,21,0.3)', flexShrink: 0,
          }}>★ PRO</div>
        )}
      </div>

      {/* ── Nav ── */}
      {showDashboardNav && (
        <nav style={{ display: 'flex', gap: 2, flex: 1, overflow: 'hidden' }}>
          {(() => {
            // Compute dashboard base: /dashboard/:client_id or /demo
            const m = location.pathname.match(/^\/dashboard\/([^/]+)/)
            const base = m ? `/dashboard/${m[1]}` : (location.pathname.startsWith('/demo') ? '/demo' : '')
            return NAV_ITEMS.map(({ path, label, icon }) => {
              const to = base ? `${base}/${path}` : `/${path}`
              const active = location.pathname.startsWith(to)
              return (
                <NavLink key={path} to={to}
                  className={active ? 'nav-link active' : 'nav-link'}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, textDecoration: 'none' }}
                >
                  <span style={{
                    fontSize: 13,
                    filter: active ? 'drop-shadow(0 0 4px rgba(124,107,255,0.7))' : 'none',
                    transition: 'filter 0.2s',
                  }}>{icon}</span>
                  {label}
                </NavLink>
              )
            })
          })()}
        </nav>
      )}

      {!showDashboardNav && <div style={{ flex: 1 }} />}

      {/* ── Active event status pill (compact) ── */}
      {showDashboardNav && isLoggedIn && !demoMode && activeEventId && s && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginRight: 10, flexShrink: 0,
          padding: '4px 10px 4px 8px', borderRadius: 20,
          background: `${s.color}18`,
          border: `1px solid ${s.color}44`,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: s.color,
            boxShadow: `0 0 6px ${s.color}`,
            animation: 'blink 1.4s ease-in-out infinite',
          }} />
          <span style={{ fontSize: 10, fontWeight: 800, color: s.color, letterSpacing: '0.04em' }}>{s.label}</span>
        </div>
      )}

      {/* ── Notification bell ── */}
      {showDashboardNav && isLoggedIn && !demoMode && (
        <div style={{ marginRight: 10, flexShrink: 0 }}>
          <NotificationBell />
        </div>
      )}

      {/* ── Demo mode ── */}
      {demoMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 22,
            background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)',
            boxShadow: '0 0 10px rgba(245,158,11,0.15)',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: '#f59e0b',
              boxShadow: '0 0 8px #f59e0b80', animation: 'blink 1.4s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 10, fontWeight: 800, color: '#fbbf24', letterSpacing: '0.06em' }}>DEMO</span>
          </div>
          <button onClick={() => navigate('/signup-register')} style={{
            padding: '8px 20px', borderRadius: 11, border: '1px solid rgba(124,107,255,0.5)',
            cursor: 'pointer',
            background: 'linear-gradient(135deg,#7c6bff,#2dd4bf)',
            color: '#fff', fontSize: 12, fontWeight: 800,
            boxShadow: '0 0 20px rgba(124,107,255,0.55), inset 0 1px 0 rgba(255,255,255,0.2)',
            transition: 'all 0.2s',
          }}>Create Account →</button>
        </div>
      )}

      {/* ── Public buttons ── */}
      {!showDashboardNav && !isLoggedIn && !demoMode && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => navigate('/login')} style={{
            padding: '8px 18px', borderRadius: 10, cursor: 'pointer',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 600,
            transition: 'all 0.18s',
          }}>Sign In</button>
          <button onClick={() => navigate('/demo')} style={{
            padding: '8px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg,#7c6bff,#2dd4bf)',
            color: '#fff', fontSize: 12, fontWeight: 800,
            boxShadow: '0 0 18px rgba(124,107,255,0.5)',
          }}>Try Demo →</button>
        </div>
      )}

      {/* ── Authenticated right section ── */}
      {showDashboardNav && isLoggedIn && companyName && !demoMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>

          {/* Search */}
          <GlassBtn onClick={() => onSearchOpen?.()} title="Search (Ctrl+K)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </GlassBtn>

          {/* Support */}
          <GlassBtn onClick={() => onSupportOpen?.()} title="Help & Support">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <circle cx="12" cy="17" r="0.5" fill="currentColor"/>
            </svg>
          </GlassBtn>

          {/* Settings */}
          <GlassBtn onClick={() => navigate('/account')} title="Account Settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </GlassBtn>

          {/* Separator */}
          <div style={{ width: 1, height: 24, background: 'linear-gradient(to bottom,transparent,rgba(124,107,255,0.35),transparent)', margin: '0 4px' }} />

          {/* Avatar + name pill */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 9,
            padding: '4px 12px 4px 4px', borderRadius: 24,
            background: 'linear-gradient(135deg,rgba(124,107,255,0.12),rgba(45,212,191,0.06))',
            border: '1px solid rgba(124,107,255,0.25)',
            boxShadow: '0 0 14px rgba(124,107,255,0.15)',
          }}>
            {/* Avatar with spinning gradient ring */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{
                position: 'absolute', inset: -2, borderRadius: '50%',
                background: 'conic-gradient(#7c6bff,#2dd4bf,#7c6bff)',
                animation: 'spin 3s linear infinite',
                opacity: 0.8,
              }} />
              <div style={{
                position: 'relative', width: 28, height: 28, borderRadius: '50%',
                background: 'linear-gradient(135deg,#7c6bff,#2dd4bf)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10.5, fontWeight: 900, color: '#fff',
                border: '1.5px solid rgba(4,6,18,0.8)',
              }}>{initials}</div>
            </div>
            <div>
              <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(196,184,255,0.5)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Welcome</div>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: '#fff', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{companyName}</div>
            </div>
          </div>

          {/* Separator */}
          <div style={{ width: 1, height: 24, background: 'linear-gradient(to bottom,transparent,rgba(124,107,255,0.35),transparent)', margin: '0 4px' }} />

          {/* Logout */}
          <button onClick={handleLogout}
            onMouseEnter={e => { e.currentTarget.style.cssText += 'background:rgba(239,68,68,0.16)!important;color:#f87171!important;border-color:rgba(239,68,68,0.4)!important;box-shadow:0 0 12px rgba(239,68,68,0.25)!important' }}
            onMouseLeave={e => { e.currentTarget.style.cssText += 'background:rgba(255,255,255,0.04)!important;color:rgba(255,255,255,0.38)!important;border-color:rgba(255,255,255,0.08)!important;box-shadow:none!important' }}
            style={{
              padding: '6px 14px', borderRadius: 9, cursor: 'pointer',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.38)', fontSize: 11.5, fontWeight: 700, transition: 'all 0.2s',
            }}>Logout</button>
        </div>
      )}
    </header>
  )
}

export default function App() {
  const navigate = useNavigate()
  const [statusInfo, setStatusInfo] = useState(null)
  const [headerState, setHeaderState] = useState({ activeEventId: null, status: null })
  const [appReady, setAppReady] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [companyName, setCompanyName] = useState(null)
  const [premium, setPremium] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const [suspended, setSuspended] = useState(false)
  const [suspendedMsg, setSuspendedMsg] = useState('')
  const location = useLocation()

  useEffect(() => {
    const token = authHelpers.getToken()
    const company = authHelpers.getCompanyName()
    setIsLoggedIn(!!token)
    setCompanyName(company)
    if (token) {
      api.getCurrentUser().then(u => setPremium(!!u.premium)).catch(() => setPremium(false))
    } else {
      setPremium(false)
    }
    // If user explicitly navigates to their account or dashboard, exit demo mode
    if (token && ['/account', '/settings', '/dashboard'].some(p => location.pathname.startsWith(p))) {
      sessionStorage.removeItem('disruptiq_demo')
    }
  }, [location.pathname])

  useEffect(() => {
    api.config()
      .then(cfg => {
        setStatusInfo(cfg.services)
        setAppReady(true)
      })
      .catch(err => {
        console.error('Config load failed:', err)
        setAppReady(true)
      })
  }, [])

  useEffect(() => {
    const handler = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const handler = (e) => {
      setSuspended(true)
      setSuspendedMsg(e.detail || 'Your account has been suspended. Contact kcsbadp@gmail.com to reactivate.')
    }
    window.addEventListener('account-suspended', handler)
    return () => window.removeEventListener('account-suspended', handler)
  }, [])

  // Persist demo session across navigation using sessionStorage
  useEffect(() => {
    if (location.pathname === '/demo') {
      sessionStorage.setItem('disruptiq_demo', '1')
    } else if (
      location.pathname === '/' ||
      location.pathname === '/login' ||
      location.pathname === '/signup-register'
    ) {
      sessionStorage.removeItem('disruptiq_demo')
    }
  }, [location.pathname])

  // Determine which nav to show based on current path
  const showDashboardNav = location.pathname.startsWith('/dashboard') || location.pathname.startsWith('/demo')
  // Demo mode is true for /demo AND for any dashboard page navigated to from /demo
  const isDemoRoute = location.pathname === '/demo' || sessionStorage.getItem('disruptiq_demo') === '1'

  const handleSuspendedLogout = () => {
    authHelpers.clearAuth()
    setSuspended(false)
    navigate('/')
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      {suspended && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          background: 'rgba(5,7,20,0.97)',
          backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 0,
        }}>
          <div style={{
            maxWidth: 480, width: '90%', padding: '40px 36px',
            background: 'rgba(17,24,39,0.95)',
            border: '1px solid rgba(239,68,68,0.35)',
            borderRadius: 18,
            boxShadow: '0 0 60px rgba(239,68,68,0.15), 0 24px 48px rgba(0,0,0,0.6)',
            textAlign: 'center',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, margin: '0 auto 20px',
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 26,
            }}>🔒</div>
            <h2 style={{ margin: '0 0 10px', color: '#fca5a5', fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' }}>
              Account Suspended
            </h2>
            <p style={{ margin: '0 0 8px', color: '#9ca3af', fontSize: 14, lineHeight: 1.6 }}>
              Your account has been temporarily suspended by the platform administrator.
            </p>
            <p style={{ margin: '0 0 28px', color: '#6b7280', fontSize: 13, lineHeight: 1.6 }}>
              To reactivate your account, please contact support at{' '}
              <a href="mailto:kcsbadp@gmail.com" style={{ color: '#93c5fd', textDecoration: 'none', fontWeight: 600 }}>
                kcsbadp@gmail.com
              </a>
            </p>
            <button onClick={handleSuspendedLogout} style={{
              padding: '11px 32px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg,#7c6bff,#2dd4bf)',
              color: '#fff', fontSize: 14, fontWeight: 700,
              boxShadow: '0 0 20px rgba(124,107,255,0.4)',
            }}>
              Sign Out
            </button>
          </div>
        </div>
      )}
      {!appReady && (
        <div style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-base)',
          zIndex: 9999,
          color: 'var(--text-pri)',
          fontFamily: 'var(--font-body)',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div className="logo-mark" style={{
              width: 64, height: 64, borderRadius: 18, fontSize: 30,
              margin: '0 auto 20px', animation: 'float-soft 2.5s ease-in-out infinite',
            }}>D</div>
            <div className="gradient-text" style={{ fontSize: 26, fontWeight: 800, marginBottom: 6, letterSpacing: '-0.02em' }}>
              DisruptIQ
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-sec)' }}>Getting things ready</div>
            <div className="typing-dots" style={{ marginTop: 14, justifyContent: 'center' }}>
              <span /><span /><span />
            </div>
          </div>
        </div>
      )}
      <AppHeader
        activeEventId={headerState.activeEventId}
        status={headerState.status}
        showDashboardNav={showDashboardNav}
        isLoggedIn={isLoggedIn}
        companyName={companyName}
        premium={premium}
        onSearchOpen={() => setSearchOpen(true)}
        onSupportOpen={() => setSupportOpen(true)}
        demoMode={isDemoRoute}
      />
      <div style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup-register" element={<SignupRegister />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/demo" element={<Dashboard statusInfo={statusInfo} onHeaderStateChange={setHeaderState} demoMode={true} />}>
            <Route path="map" element={<SupplyChainMap />} />
            <Route path="dependencies" element={<DependencyHeatmap />} />
            <Route path="tier2" element={<Tier2Visibility />} />
            <Route path="trends" element={<SupplierTrends />} />
            <Route path="reports" element={<Reports />} />
            <Route path="history" element={<EventHistory />} />
            <Route path="weather" element={<WeatherMonitor />} />
            <Route path="config" element={<ConfigPage />} />
          </Route>
          <Route path="/dashboard/:client_id" element={<ProtectedRoute><Dashboard statusInfo={statusInfo} onHeaderStateChange={setHeaderState} /></ProtectedRoute>}>
            <Route path="map" element={<SupplyChainMap />} />
            <Route path="dependencies" element={<DependencyHeatmap />} />
            <Route path="tier2" element={<Tier2Visibility />} />
            <Route path="trends" element={<SupplierTrends />} />
            <Route path="reports" element={<Reports />} />
            <Route path="history" element={<EventHistory />} />
            <Route path="weather" element={<WeatherMonitor />} />
            <Route path="config" element={<ConfigPage />} />
          </Route>
          <Route path="/settings" element={<ProtectedRoute><AccountSettings /></ProtectedRoute>} />
          <Route path="/account" element={<ProtectedRoute><AccountSettings /></ProtectedRoute>} />
          <Route path="/account/:tab" element={<ProtectedRoute><AccountSettings /></ProtectedRoute>} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </div>
      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
      <SupportModal isOpen={supportOpen} onClose={() => setSupportOpen(false)} />
    </div>
  )
}
