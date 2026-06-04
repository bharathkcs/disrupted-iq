import React, { useEffect, useState } from 'react'
import { api } from '../services/api.js'

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState({ notifications: [], unread_count: 0 })

  useEffect(() => {
    let timer
    const load = () => api.notifications().then(setData).catch(() => {})
    load()
    timer = setInterval(load, 30000)
    return () => clearInterval(timer)
  }, [])

  const markAllRead = async () => {
    await api.markAllNotificationsRead().catch(() => {})
    setData(prev => ({
      ...prev,
      unread_count: 0,
      notifications: prev.notifications.map(item => ({ ...item, read: true })),
    }))
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(prev => !prev)}
        style={{ background: 'transparent', border: 'none', color: 'var(--text-pri)', cursor: 'pointer', position: 'relative' }}
        title="Notifications"
      >
        🔔
        {data.unread_count > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -8, minWidth: 16, height: 16, borderRadius: 999,
            background: '#ef4444', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {data.unread_count}
          </span>
        )}
      </button>
      {open && (
        <>
          {/* Click-outside catcher */}
          <div onClick={() => setOpen(false)} style={{
            position: 'fixed', inset: 0, zIndex: 199, background: 'rgba(0,0,0,0.2)',
          }} />
          <div style={{
            position: 'fixed',
            right: 24,
            top: 70,
            width: 400,
            maxWidth: 'calc(100vw - 48px)',
            maxHeight: '75vh',
            overflowY: 'auto',
            background: 'rgba(6, 9, 24, 0.98)',
            border: '1px solid var(--glass-border-bright)',
            borderRadius: 12,
            padding: 14,
            zIndex: 1000,
            boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
            wordWrap: 'break-word',
            overflowWrap: 'break-word',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--glass-border)' }}>
              <strong style={{ fontSize: 14, color: 'var(--text-pri)' }}>Notifications</strong>
              <div style={{ display: 'flex', gap: 8 }}>
                {data.notifications.length > 0 && (
                  <button onClick={markAllRead} style={{
                    background: 'transparent', border: 'none', color: 'var(--primary)',
                    cursor: 'pointer', fontSize: 11, fontWeight: 500,
                  }}>Mark all read</button>
                )}
                <button onClick={() => setOpen(false)} style={{
                  background: 'transparent', border: 'none', color: 'var(--text-dim)',
                  cursor: 'pointer', fontSize: 14,
                }}>✕</button>
              </div>
            </div>
            {data.notifications.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-sec)', textAlign: 'center', padding: '20px 0' }}>
                No notifications yet.
              </div>
            )}
            {data.notifications.map(item => (
              <div key={item.id} style={{
                padding: '10px 0',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                opacity: item.read ? 0.65 : 1,
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-pri)', wordBreak: 'break-word' }}>{item.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-sec)', marginTop: 4, lineHeight: 1.5, wordBreak: 'break-word' }}>{item.message}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
