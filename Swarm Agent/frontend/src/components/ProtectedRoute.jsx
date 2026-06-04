import React, { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { api } from '../services/api.js'
import { authHelpers } from '../services/auth.js'

export default function ProtectedRoute({ children }) {
  const location = useLocation()
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    if (!authHelpers.getToken()) {
      setStatus('unauthenticated')
      return
    }
    api.getCurrentUser()
      .then(() => setStatus('ready'))
      .catch(() => {
        authHelpers.clearAuth()
        setStatus('unauthenticated')
      })
  }, [location.pathname])

  if (status === 'checking') {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-sec)', fontSize: 14 }}>
        Verifying your session…
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <Navigate to={`/login?returnUrl=${encodeURIComponent(location.pathname + location.search)}`} replace />
  }

  return children
}
