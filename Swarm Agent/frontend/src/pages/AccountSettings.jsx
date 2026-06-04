import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../services/api'
import { authHelpers } from '../services/auth.js'
import UpgradeModal, { isLimitMessage } from '../components/UpgradeModal'

function UpgradeError({ message }) {
  const isLimit = message && (
    message.includes('Premium') ||
    message.includes('kcsbadp') ||
    message.includes('free-plan') ||
    message.includes('slot') ||
    message.includes('limit of 30') ||
    message.includes('30 supplier')
  )
  if (isLimit) {
    return (
      <div style={{ marginTop: 8, padding: '16px 20px', background: 'linear-gradient(135deg, rgba(124,107,255,0.12), rgba(239,68,68,0.10))', border: '2px solid rgba(124,107,255,0.4)', borderRadius: 10, boxShadow: '0 4px 20px rgba(124,107,255,0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 20 }}>🚫</span>
          <span style={{ fontWeight: 800, fontSize: 14, color: '#f87171', letterSpacing: 0.3 }}>Free Plan Limit Reached</span>
        </div>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.75)', lineHeight: 1.7, marginBottom: 12 }}>
          Your file exceeds the <strong style={{ color: '#fff' }}>30-supplier limit</strong> on the free plan.
          {' '}No suppliers were imported. Upgrade to <strong style={{ color: '#a78bfa' }}>DisruptIQ Premium</strong> to unlock unlimited supplier imports and advanced features.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <a
            href="mailto:kcsbadp@gmail.com?subject=DisruptIQ Premium Upgrade&body=Hi, I'd like to upgrade to DisruptIQ Premium."
            style={{ padding: '8px 18px', background: 'linear-gradient(135deg,#7c6bff,#2dd4bf)', borderRadius: 7, color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none', boxShadow: '0 2px 10px rgba(124,107,255,0.35)' }}
          >
            ✉ Upgrade to Premium
          </a>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>kcsbadp@gmail.com</span>
        </div>
      </div>
    )
  }
  return (
    <div style={{ marginTop: 8, padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: '#f87171' }}>{message}</div>
    </div>
  )
}

export default function AccountSettings() {
  const navigate = useNavigate()
  const { tab } = useParams()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [activeTab, setActiveTab] = useState('profile')

  // Profile form state
  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [industry, setIndustry] = useState('')

  // Password change form state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordStrength, setPasswordStrength] = useState(0)

  // Onboarding checklist state
  const [checklist, setChecklist] = useState(null)

  // Sessions state
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [revokingJti, setRevokingJti] = useState(null)

  // Delete account state
  const [deletePhase, setDeletePhase] = useState('idle')  // idle | confirming | pending
  const [deleteReason, setDeleteReason] = useState('')

  // Suppliers state
  const [suppliers, setSuppliers] = useState([])
  const [suppliersLoading, setSuppliersLoading] = useState(false)
  const [supplierFormOpen, setSupplierFormOpen] = useState(false)
  const [addingSupplier, setAddingSupplier] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [updatingSupplier, setUpdatingSupplier] = useState(false)
  const [newSupplier, setNewSupplier] = useState({
    name: '', zone: '', categories: '',
    buffer_stock_days: 14, sites: 1, reliability: 85, proximity_score: 5
  })
  const [customZone, setCustomZone] = useState('')

  // Bulk import state
  const [importTab, setImportTab] = useState('excel')
  const [xlsxFile, setXlsxFile] = useState(null)
  const [xlsxUploading, setXlsxUploading] = useState(false)
  const [xlsxResult, setXlsxResult] = useState(null)
  const [xlsxError, setXlsxError] = useState(null)
  const [csvFile, setCsvFile] = useState(null)
  const [csvUploading, setCsvUploading] = useState(false)
  const [csvResult, setCsvResult] = useState(null)
  const [csvError, setCsvError] = useState(null)
  const [downloadingTpl, setDownloadingTpl] = useState(false)

  // Free-plan upgrade popup
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgradeMsg, setUpgradeMsg] = useState('')
  const showUpgrade = (msg) => { setUpgradeMsg(msg || ''); setUpgradeOpen(true) }

  // Dynamic zones from uploaded suppliers + 'Other' option
  const dynamicZones = [...new Set((suppliers || []).map(s => s.zone).filter(Boolean))]
  const VALID_ZONES = dynamicZones.length > 0 ? [...dynamicZones, 'Other'] : ['Other']

  // Feedback state
  const [feedbackRating, setFeedbackRating] = useState(0)
  const [feedbackHovered, setFeedbackHovered] = useState(0)
  const [feedbackComment, setFeedbackComment] = useState('')
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [feedbackSuccess, setFeedbackSuccess] = useState(false)
  const [lastFeedback, setLastFeedback] = useState(null)

  // Notification settings state
  const [notificationSettings, setNotificationSettings] = useState({
    severe_disruption_email: true
  })
  const [notificationSaving, setNotificationSaving] = useState(false)

  const industries = [
    'Manufacturing', 'Electronics', 'Automotive', 'Pharmaceutical',
    'FMCG', 'Logistics', 'Healthcare', 'Other'
  ]

  useEffect(() => {
    loadUserInfo()
  }, [])

  useEffect(() => {
    if (tab) setActiveTab(tab)
  }, [tab])

  useEffect(() => {
    if (activeTab === 'onboarding' && !checklist) {
      api.onboardingChecklist().then(setChecklist).catch(err => console.error('Failed to load checklist', err))
    }
  }, [activeTab, checklist])

  useEffect(() => {
    if (activeTab === 'security') {
      setSessionsLoading(true)
      api.listSessions().then(r => setSessions(r.sessions || [])).catch(err => console.error('Failed to load sessions', err)).finally(() => setSessionsLoading(false))
    }
  }, [activeTab])

  useEffect(() => {
    if (activeTab === 'suppliers') {
      setSuppliersLoading(true)
      api.suppliers().then(r => setSuppliers(r.suppliers || r || [])).catch(() => setSuppliers([])).finally(() => setSuppliersLoading(false))
    }
  }, [activeTab])

  useEffect(() => {
    if (activeTab === 'notifications') {
      api.getNotificationSettings()
        .then(r => setNotificationSettings(r || { severe_disruption_email: true }))
        .catch(err => console.error('Failed to load notification settings', err))
    }
  }, [activeTab])

  const loadUserInfo = async () => {
    try {
      const userData = await api.getCurrentUser()
      setUser(userData)
      setCompanyName(userData.company_name || '')
      setContactName(userData.contact_name || '')
      setIndustry(userData.industry || '')
    } catch (err) {
      setError('Failed to load account information')
    } finally {
      setLoading(false)
    }
  }

  const checkPasswordStrength = (pwd) => {
    let strength = 0
    if (pwd.length >= 8) strength++
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) strength++
    if (/\d/.test(pwd)) strength++
    if (/[!@#$%^&*]/.test(pwd)) strength++
    return strength
  }

  const handleProfileSave = async (e) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setSaving(true)

    try {
      await api.updateProfile({
        company_name: companyName,
        industry: industry,
        contact_name: contactName,
      })
      setSuccess('Profile updated successfully')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handlePasswordChange = async (e) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (passwordStrength < 4) {
      setError('Password must meet all requirements')
      return
    }

    setSaving(true)
    try {
      await api.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      })
      setSuccess('Password changed successfully')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordStrength(0)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}>
        <div className="panel panel-pad">
          <span className="mono c-dim">Loading account settings...</span>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}>
        <div className="panel panel-pad">
          <span className="mono c-dim">Please log in to view account settings</span>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: 'var(--text-pri)', marginBottom: 8 }}>
          Account Settings
        </h1>
        <p style={{ margin: 0, color: 'var(--text-sec)', fontSize: 14 }}>
          Manage your profile and account preferences
        </p>
      </div>

      {error && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '8px',
          padding: '12px 14px',
          color: 'var(--danger)',
          fontSize: 13
        }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{
          background: 'rgba(34, 197, 94, 0.1)',
          border: '1px solid rgba(34, 197, 94, 0.3)',
          borderRadius: '8px',
          padding: '12px 14px',
          color: 'var(--success)',
          fontSize: 13
        }}>
          ✓ {success}
        </div>
      )}

      <div className="panel">
        {/* Tab navigation */}
        <div style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid var(--glass-border)',
        }}>
          {[
            { id: 'profile', label: 'Profile' },
            { id: 'password', label: 'Change Password' },
            { id: 'suppliers', label: '📦 Suppliers' },
            { id: 'notifications', label: '📧 Notifications' },
            { id: 'security', label: 'Security' },
            { id: 'feedback', label: 'Feedback' },
            { id: 'account', label: 'Account Info' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setError(null); setSuccess(null) }}
              style={{
                flex: 1,
                padding: '14px 16px',
                background: activeTab === tab.id ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                border: activeTab === tab.id ? '1px solid var(--primary)' : '1px solid transparent',
                borderBottom: activeTab === tab.id ? 'none' : '1px solid var(--glass-border)',
                color: activeTab === tab.id ? 'var(--primary)' : 'var(--text-sec)',
                fontSize: 13,
                fontWeight: activeTab === tab.id ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ padding: '20px' }}>
          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <form onSubmit={handleProfileSave} style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 600 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: 'var(--text-pri)' }}>
                  Company Name
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Enter company name"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-pri)',
                    fontSize: 13,
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: 'var(--text-pri)' }}>
                  Contact Name
                </label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Your name"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-pri)',
                    fontSize: 13,
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: 'var(--text-pri)' }}>
                  Industry
                </label>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-pri)',
                    fontSize: 13,
                    boxSizing: 'border-box'
                  }}
                >
                  <option value="">Select an industry</option>
                  {industries.map(ind => (
                    <option key={ind} value={ind}>{ind}</option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="btn btn-primary"
                style={{ alignSelf: 'flex-start' }}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          )}

          {/* Password Tab */}
          {activeTab === 'password' && (
            <form onSubmit={handlePasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 600 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: 'var(--text-pri)' }}>
                  Current Password
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter your current password"
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-pri)',
                    fontSize: 13,
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: 'var(--text-pri)' }}>
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value)
                    setPasswordStrength(checkPasswordStrength(e.target.value))
                  }}
                  placeholder="Enter new password"
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-pri)',
                    fontSize: 13,
                    boxSizing: 'border-box'
                  }}
                />
                {newPassword && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{
                      height: '4px',
                      background: '#e5e7eb',
                      borderRadius: '2px',
                      overflow: 'hidden',
                      marginBottom: 6
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${(passwordStrength / 4) * 100}%`,
                        background: passwordStrength <= 1 ? '#ef4444' : passwordStrength <= 2 ? '#f59e0b' : passwordStrength <= 3 ? '#3b82f6' : '#10b981',
                        transition: 'width 0.3s'
                      }} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-sec)' }}>
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        <li style={{ color: newPassword.length >= 8 ? 'var(--success)' : 'inherit' }}>✓ At least 8 characters</li>
                        <li style={{ color: /[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword) ? 'var(--success)' : 'inherit' }}>✓ Upper and lowercase</li>
                        <li style={{ color: /\d/.test(newPassword) ? 'var(--success)' : 'inherit' }}>✓ At least one number</li>
                        <li style={{ color: /[!@#$%^&*]/.test(newPassword) ? 'var(--success)' : 'inherit' }}>✓ Special character</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: 'var(--text-pri)' }}>
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-pri)',
                    fontSize: 13,
                    boxSizing: 'border-box'
                  }}
                />
                {confirmPassword && newPassword !== confirmPassword && (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--danger)' }}>
                    Passwords do not match
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={saving || passwordStrength < 4}
                className="btn btn-primary"
                style={{ alignSelf: 'flex-start' }}
              >
                {saving ? 'Changing...' : 'Change Password'}
              </button>
            </form>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <div style={{ maxWidth: 600 }}>
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-pri)', marginBottom: 8 }}>
                  📧 Email Notifications
                </h2>
                <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>
                  Manage email alerts for disruptions detected in your supply chain
                </p>
              </div>

              {/* Severe Disruption Email Toggle */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 18px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--glass-border)',
                borderRadius: 10,
                marginBottom: 20
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-pri)', marginBottom: 6 }}>
                    🚨 Severe Disruption Alerts
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                    Receive email notifications when disruptions (severity ≥ 6) are detected for your suppliers. Disable to stop receiving alerts.
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setNotificationSaving(true)
                    try {
                      await api.updateNotificationSettings({
                        severe_disruption_email: !notificationSettings.severe_disruption_email
                      })
                      setNotificationSettings(prev => ({
                        ...prev,
                        severe_disruption_email: !prev.severe_disruption_email
                      }))
                      setSuccess(
                        notificationSettings.severe_disruption_email
                          ? 'Email notifications disabled'
                          : 'Email notifications enabled'
                      )
                      setTimeout(() => setSuccess(null), 3000)
                    } catch (err) {
                      setError('Failed to update notification settings')
                    } finally {
                      setNotificationSaving(false)
                    }
                  }}
                  disabled={notificationSaving}
                  style={{
                    marginLeft: 16,
                    flexShrink: 0,
                    padding: '10px 18px',
                    background: notificationSettings.severe_disruption_email ? 'var(--success)' : 'rgba(255, 255, 255, 0.1)',
                    border: 'none',
                    borderRadius: 6,
                    color: 'white',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: notificationSaving ? 'not-allowed' : 'pointer',
                    opacity: notificationSaving ? 0.6 : 1,
                    transition: 'all 0.2s'
                  }}
                >
                  {notificationSaving ? '...' : notificationSettings.severe_disruption_email ? '✓ Enabled' : 'Enable'}
                </button>
              </div>

              {/* Info Box */}
              <div style={{
                padding: '16px 18px',
                background: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: 10,
                fontSize: 12,
                color: 'var(--text-dim)',
                lineHeight: 1.6
              }}>
                <strong style={{ color: 'var(--text-pri)' }}>ℹ️ How it works:</strong>
                <div style={{ marginTop: 8 }}>
                  When a disruption is detected with severity ≥ 6, the system will:
                  <div style={{ marginTop: 6, marginLeft: 12, color: 'var(--text-dim)' }}>
                    • Run all 9 AI agents to analyze the impact<br />
                    • Send you an email alert if this toggle is <strong>enabled</strong><br />
                    • Highlight affected suppliers and recommended actions
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Account Info Tab */}
          {activeTab === 'account' && (
            <div style={{ maxWidth: 600 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '16px 24px' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 6 }}>
                    Email
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-pri)', fontWeight: 500 }}>
                    {user.email}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 6 }}>
                    Client ID
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-pri)', fontFamily: 'monospace' }}>
                    {user.client_id}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 6 }}>
                    Account Created
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-pri)' }}>
                    {new Date(user.created_at).toLocaleDateString()}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 6 }}>
                    Last Login
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-pri)' }}>
                    {new Date(user.last_login).toLocaleDateString()}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 6 }}>
                    Plan
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-pri)' }}>
                    {user.plan || 'Explorer'}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 6 }}>
                    Suppliers
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-pri)' }}>
                    {user.supplier_count || 0}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--glass-border)' }}>
                <button
                  onClick={() => {
                    authHelpers.clearAuth()
                    navigate('/login')
                  }}
                  style={{
                    padding: '10px 16px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--danger)',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer'
                  }}
                >
                  Logout
                </button>
              </div>

              {/* Danger Zone */}
              <div style={{ marginTop: 32, paddingTop: 24, borderTop: '2px solid rgba(239, 68, 68, 0.3)' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--danger)', marginBottom: 4 }}>⚠️ Danger Zone</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16 }}>Permanent account deletion cannot be undone</div>

                {deletePhase === 'idle' && (
                  <button
                    onClick={() => setDeletePhase('confirming')}
                    style={{
                      padding: '10px 16px',
                      background: 'transparent',
                      border: '1px solid rgba(239, 68, 68, 0.5)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--danger)',
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: 'pointer'
                    }}
                  >
                    Delete Account
                  </button>
                )}

                {deletePhase === 'confirming' && (
                  <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-sm)', padding: 16 }}>
                    <div style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 12, fontWeight: 500 }}>Are you sure? This action cannot be undone.</div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', marginBottom: 6, fontSize: 12, fontWeight: 500, color: 'var(--text-pri)' }}>Why are you leaving?</label>
                      <select
                        value={deleteReason}
                        onChange={(e) => setDeleteReason(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid var(--glass-border)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--text-pri)',
                          fontSize: 13,
                          boxSizing: 'border-box'
                        }}
                      >
                        <option value="">Select a reason...</option>
                        <option value="too_expensive">Too expensive</option>
                        <option value="found_alternative">Found an alternative</option>
                        <option value="not_useful">Not useful for my needs</option>
                        <option value="privacy_concerns">Privacy concerns</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <button
                        onClick={() => { setDeletePhase('idle'); setDeleteReason(''); }}
                        style={{
                          flex: 1,
                          padding: '10px 16px',
                          background: 'rgba(107, 114, 128, 0.2)',
                          border: '1px solid rgba(107, 114, 128, 0.3)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--text-pri)',
                          fontSize: 13,
                          fontWeight: 500,
                          cursor: 'pointer'
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            const labelMap = {
                              too_expensive: 'Too expensive',
                              found_alternative: 'Found an alternative',
                              not_useful: 'Not useful for my needs',
                              privacy_concerns: 'Privacy concerns',
                              other: 'Other',
                            }
                            await api.requestAccountDelete(deleteReason, labelMap[deleteReason] || deleteReason)
                            setDeletePhase('pending')
                            // Logout after 3 seconds
                            setTimeout(() => {
                              authHelpers.clearAuth()
                              navigate('/')
                            }, 3000)
                          } catch (err) {
                            alert('Error: ' + (err.response?.data?.detail || err.message))
                          }
                        }}
                        style={{
                          flex: 1,
                          padding: '10px 16px',
                          background: 'rgba(239, 68, 68, 0.2)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--danger)',
                          fontSize: 13,
                          fontWeight: 500,
                          cursor: 'pointer'
                        }}
                      >
                        Yes, Delete My Account
                      </button>
                    </div>
                  </div>
                )}

                {deletePhase === 'pending' && (
                  <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-sm)', padding: 16 }}>
                    <div style={{ fontSize: 13, color: 'var(--danger)', lineHeight: 1.5 }}>
                      ✓ Account permanently deleted.<br/>
                      <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>All your data has been removed. Signing you out in 3 seconds...</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Feedback Tab */}
          {activeTab === 'feedback' && (
            <div style={{ maxWidth: 600 }}>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-pri)', marginBottom: 4 }}>Rate Your Experience</div>
                <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 16 }}>Help us improve DisruptIQ</div>

                {/* Star Rating */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      onClick={() => setFeedbackRating(star)}
                      onMouseEnter={() => setFeedbackHovered(star)}
                      onMouseLeave={() => setFeedbackHovered(0)}
                      style={{
                        fontSize: 36,
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        opacity: (feedbackHovered || feedbackRating) >= star ? 1 : 0.3,
                        color: (feedbackHovered || feedbackRating) >= star ? '#FCD34D' : 'var(--text-dim)',
                        transition: 'all 0.2s',
                        padding: 0
                      }}
                    >
                      {(feedbackHovered || feedbackRating) >= star ? '★' : '☆'}
                    </button>
                  ))}
                </div>

                {/* Comment Textarea */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: 'var(--text-pri)' }}>Tell us more (optional)</label>
                  <textarea
                    value={feedbackComment}
                    onChange={(e) => setFeedbackComment(e.target.value)}
                    placeholder="What could we improve? What did you like?"
                    style={{
                      width: '100%',
                      height: 100,
                      padding: '10px 12px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-pri)',
                      fontSize: 13,
                      fontFamily: 'inherit',
                      boxSizing: 'border-box',
                      resize: 'vertical'
                    }}
                  />
                </div>

                {/* Submit Button */}
                <button
                  onClick={async () => {
                    if (feedbackRating === 0) {
                      alert('Please select a rating')
                      return
                    }
                    setFeedbackSubmitting(true)
                    try {
                      await api.submitFeedback({ rating: feedbackRating, comment: feedbackComment })
                      setLastFeedback({ rating: feedbackRating, comment: feedbackComment, created_at: new Date().toISOString() })
                      setFeedbackRating(0)
                      setFeedbackComment('')
                      setFeedbackSuccess(true)
                      setTimeout(() => setFeedbackSuccess(false), 3000)
                    } catch (err) {
                      alert('Error: ' + (err.response?.data?.detail || err.message))
                    } finally {
                      setFeedbackSubmitting(false)
                    }
                  }}
                  disabled={feedbackSubmitting}
                  style={{
                    padding: '10px 16px',
                    background: 'var(--primary)',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: 'white',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: feedbackSubmitting ? 'not-allowed' : 'pointer',
                    opacity: feedbackSubmitting ? 0.6 : 1
                  }}
                >
                  {feedbackSubmitting ? 'Submitting...' : 'Submit Feedback'}
                </button>

                {feedbackSuccess && (
                  <div style={{ marginTop: 12, padding: 12, background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: 'var(--radius-sm)', color: 'var(--success)', fontSize: 13 }}>
                    ✓ Thank you for your feedback!
                  </div>
                )}

                {/* Last Feedback */}
                {lastFeedback && (
                  <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--glass-border)' }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-pri)', marginBottom: 8 }}>Your previous feedback</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                      {[1, 2, 3, 4, 5].map(star => (
                        <span key={star} style={{ fontSize: 16, opacity: lastFeedback.rating >= star ? 1 : 0.3 }}>★</span>
                      ))}
                      <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{new Date(lastFeedback.created_at).toLocaleDateString()}</span>
                    </div>
                    {lastFeedback.comment && (
                      <div style={{ fontSize: 12, color: 'var(--text-sec)', fontStyle: 'italic', marginTop: 6 }}>"{lastFeedback.comment}"</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div style={{ maxWidth: 600 }}>
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-pri)', marginBottom: 16 }}>
                  Active Sessions
                </h3>
                {sessionsLoading ? (
                  <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Loading sessions...</div>
                ) : sessions.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>No active sessions</div>
                ) : (
                  <>
                    {sessions.map(session => (
                      <div
                        key={session.jti}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '12px 16px',
                          background: 'rgba(30, 41, 59, 0.5)',
                          border: '1px solid var(--glass-border)',
                          borderRadius: 'var(--radius-sm)',
                          marginBottom: 12
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                            <span style={{ fontSize: 18 }}>
                              {session.device === 'Mobile' ? '📱' : '🖥️'}
                            </span>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-pri)' }}>
                                {session.browser} on {session.device}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                                {session.ip.replace(/\.\d+$/, '.xxx')} · {new Date(session.issued_at).toLocaleString()}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          {session.current ? (
                            <div style={{ padding: '4px 12px', background: 'rgba(34, 197, 94, 0.2)', border: '1px solid rgba(34, 197, 94, 0.4)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--success)', fontWeight: 500 }}>
                              Current
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setRevokingJti(session.jti)
                                api.revokeSession(session.jti)
                                  .then(() => setSessions(prev => prev.filter(s => s.jti !== session.jti)))
                                  .catch(e => alert('Error: ' + e.message))
                                  .finally(() => setRevokingJti(null))
                              }}
                              disabled={revokingJti === session.jti}
                              style={{
                                padding: '4px 12px',
                                background: revokingJti === session.jti ? 'rgba(107, 114, 128, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                                border: revokingJti === session.jti ? '1px solid rgba(107, 114, 128, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: 12,
                                color: revokingJti === session.jti ? 'var(--text-dim)' : 'var(--danger)',
                                fontWeight: 500,
                                cursor: revokingJti === session.jti ? 'not-allowed' : 'pointer'
                              }}
                            >
                              {revokingJti === session.jti ? 'Revoking...' : 'Revoke'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        api.logoutAll().then(() => {
                          setSessions([])
                          alert('All other sessions logged out')
                        }).catch(e => alert('Error: ' + e.message))
                      }}
                      style={{
                        marginTop: 16,
                        padding: '10px 16px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--danger)',
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: 'pointer'
                      }}
                    >
                      Log out all other sessions
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Suppliers Tab */}
          {activeTab === 'suppliers' && (
            <div style={{ maxWidth: 800 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-pri)' }}>Your Suppliers</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                    {user?.premium
                      ? <span style={{ color: '#fcd34d', fontWeight: 700 }}>★ {suppliers.length} suppliers · Pro plan — unlimited imports</span>
                      : `${suppliers.length} / 30 suppliers · free plan`}
                  </div>
                </div>
                <button
                  onClick={() => setSupplierFormOpen(v => !v)}
                  style={{
                    padding: '9px 16px',
                    background: 'rgba(99, 102, 241, 0.15)',
                    border: '1px solid var(--primary)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--primary)',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {supplierFormOpen ? '✕ Cancel' : '+ Add Supplier'}
                </button>
              </div>

              {/* ── Bulk Import Section ── */}
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', borderRadius: 10, marginBottom: 24, overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-pri)' }}>Bulk Import</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Upload up to 30 suppliers at once via Excel or CSV</div>
                  </div>
                  <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--glass-border)' }}>
                    {[{ id: 'excel', label: 'Excel' }, { id: 'csv', label: 'CSV' }].map(t => (
                      <button key={t.id} onClick={() => { setImportTab(t.id); setXlsxResult(null); setXlsxError(null); setCsvResult(null); setCsvError(null) }}
                        style={{ padding: '5px 14px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                          background: importTab === t.id ? 'var(--primary)' : 'transparent',
                          color: importTab === t.id ? '#fff' : 'var(--text-dim)' }}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {importTab === 'excel' && (
                    <>
                      <div style={{ fontSize: 12, color: 'var(--text-sec)' }}>
                        Download the template, fill in your data, and upload it back. Required columns: <strong>Supplier Name</strong> and <strong>Zone</strong>.
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button onClick={async () => { setDownloadingTpl(true); try { const blob = await api.downloadSupplierTemplate(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'disruptiq_supplier_template.xlsx'; a.click(); URL.revokeObjectURL(url) } catch {} finally { setDownloadingTpl(false) } }}
                          style={{ padding: '7px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)', borderRadius: 6, color: 'var(--text-sec)', fontSize: 12, cursor: 'pointer' }} disabled={downloadingTpl}>
                          {downloadingTpl ? 'Downloading…' : '⬇ Template (.xlsx)'}
                        </button>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: 'var(--text-sec)' }}>
                          {xlsxFile ? `📄 ${xlsxFile.name}` : '📁 Choose .xlsx file'}
                          <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { setXlsxFile(e.target.files?.[0] || null); setXlsxResult(null); setXlsxError(null) }} />
                        </label>
                        <button onClick={async () => { if (!xlsxFile) return; setXlsxUploading(true); setXlsxResult(null); setXlsxError(null); try { const res = await api.uploadSupplierExcel(xlsxFile); setXlsxResult(res); setXlsxFile(null); if (res.limit_reached) showUpgrade(res.message); const r = await api.suppliers(); setSuppliers(r.suppliers || r || []) } catch (err) { setXlsxError(err.message); if (isLimitMessage(err.message)) showUpgrade(err.message) } finally { setXlsxUploading(false) } }}
                          disabled={!xlsxFile || xlsxUploading}
                          style={{ padding: '7px 16px', background: 'var(--primary)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: !xlsxFile || xlsxUploading ? 'not-allowed' : 'pointer', opacity: !xlsxFile ? 0.5 : 1 }}>
                          {xlsxUploading ? 'Uploading…' : 'Upload'}
                        </button>
                      </div>
                      {xlsxResult && <div style={{ padding: '8px 12px', background: 'rgba(45,212,191,0.1)', border: '1px solid rgba(45,212,191,0.3)', borderRadius: 6, fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>✓ {xlsxResult.suppliers_added} supplier{xlsxResult.suppliers_added !== 1 ? 's' : ''} added. Total: {xlsxResult.total_suppliers}{user?.premium ? '' : '/30'}.</div>}
                      {xlsxError && <UpgradeError message={xlsxError} />}
                    </>
                  )}

                  {importTab === 'csv' && (
                    <>
                      <div style={{ fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.6 }}>
                        Upload a <strong>.csv</strong> file with a header row. Required columns: <strong>Supplier Name</strong>, <strong>Zone</strong>. Optional: Categories, Buffer Stock Days, Sites, Reliability (%), Proximity Score (1-10).
                      </div>
                      <div style={{ fontFamily: 'monospace', fontSize: 10, background: 'rgba(0,0,0,0.3)', borderRadius: 6, padding: '8px 10px', color: 'var(--text-dim)', lineHeight: 1.7 }}>
                        Supplier Name,Zone,Categories,Buffer Stock Days<br />
                        Acme Parts Ltd,Chennai,Automotive,14<br />
                        Sunrise Textiles,Mumbai,Textile,7
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: 'var(--text-sec)' }}>
                          {csvFile ? `📄 ${csvFile.name}` : '📁 Choose .csv file'}
                          <input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => { setCsvFile(e.target.files?.[0] || null); setCsvResult(null); setCsvError(null) }} />
                        </label>
                        <button onClick={async () => { if (!csvFile) return; setCsvUploading(true); setCsvResult(null); setCsvError(null); try { const res = await api.uploadSupplierCsv(csvFile); setCsvResult(res); setCsvFile(null); if (res.limit_reached) showUpgrade(res.message); const r = await api.suppliers(); setSuppliers(r.suppliers || r || []) } catch (err) { setCsvError(err.message); if (isLimitMessage(err.message)) showUpgrade(err.message) } finally { setCsvUploading(false) } }}
                          disabled={!csvFile || csvUploading}
                          style={{ padding: '7px 16px', background: 'var(--primary)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: !csvFile || csvUploading ? 'not-allowed' : 'pointer', opacity: !csvFile ? 0.5 : 1 }}>
                          {csvUploading ? 'Uploading…' : 'Upload'}
                        </button>
                      </div>
                      {csvResult && <div style={{ padding: '8px 12px', background: 'rgba(45,212,191,0.1)', border: '1px solid rgba(45,212,191,0.3)', borderRadius: 6, fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>✓ {csvResult.suppliers_added} supplier{csvResult.suppliers_added !== 1 ? 's' : ''} added. Total: {csvResult.total_suppliers}{user?.premium ? '' : '/30'}.</div>}
                      {csvError && <UpgradeError message={csvError} />}
                    </>
                  )}
                </div>
              </div>

              {/* Add/Edit supplier form */}
              {supplierFormOpen && (
                <div style={{
                  background: 'rgba(99, 102, 241, 0.05)',
                  border: '1px solid rgba(99, 102, 241, 0.2)',
                  borderRadius: 8,
                  padding: 20,
                  marginBottom: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)', marginBottom: 2 }}>
                    {editingId ? '✏️ Edit Supplier' : '➕ New Supplier'}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: 5, fontSize: 12, fontWeight: 500, color: 'var(--text-sec)' }}>Supplier Name *</label>
                      <input
                        type="text"
                        value={newSupplier.name}
                        onChange={e => setNewSupplier(s => ({ ...s, name: e.target.value }))}
                        placeholder="e.g. Acme Parts Ltd"
                        style={{ width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', borderRadius: 6, color: 'var(--text-pri)', fontSize: 13, boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: 5, fontSize: 12, fontWeight: 500, color: 'var(--text-sec)' }}>Zone *</label>
                      <select
                        value={newSupplier.zone}
                        onChange={e => { setNewSupplier(s => ({ ...s, zone: e.target.value })); if (e.target.value !== 'Other') setCustomZone('') }}
                        style={{ width: '100%', padding: '8px 10px', background: 'rgba(30,30,40,0.95)', border: '1px solid var(--glass-border)', borderRadius: 6, color: 'var(--text-pri)', fontSize: 13, boxSizing: 'border-box' }}
                      >
                        <option value="" style={{ color: '#111', background: '#fff' }}>Select zone</option>
                        {VALID_ZONES.map(z => <option key={z} value={z} style={{ color: '#111', background: '#fff' }}>{z}</option>)}
                      </select>
                      {newSupplier.zone === 'Other' && (
                        <input
                          type="text"
                          value={customZone}
                          onChange={e => setCustomZone(e.target.value)}
                          placeholder="Enter your zone / city"
                          style={{ width: '100%', padding: '8px 10px', marginTop: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--primary)', borderRadius: 6, color: 'var(--text-pri)', fontSize: 13, boxSizing: 'border-box' }}
                        />
                      )}
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: 5, fontSize: 12, fontWeight: 500, color: 'var(--text-sec)' }}>Categories * (comma-separated)</label>
                    <input
                      type="text"
                      value={newSupplier.categories}
                      onChange={e => setNewSupplier(s => ({ ...s, categories: e.target.value }))}
                      placeholder="e.g. Raw Materials, Packaging"
                      style={{ width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', borderRadius: 6, color: 'var(--text-pri)', fontSize: 13, boxSizing: 'border-box' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: 5, fontSize: 12, fontWeight: 500, color: 'var(--text-sec)' }}>Buffer Days</label>
                      <input type="number" min={0} max={365} value={newSupplier.buffer_stock_days}
                        onChange={e => setNewSupplier(s => ({ ...s, buffer_stock_days: +e.target.value }))}
                        style={{ width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', borderRadius: 6, color: 'var(--text-pri)', fontSize: 13, boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: 5, fontSize: 12, fontWeight: 500, color: 'var(--text-sec)' }}>Sites</label>
                      <input type="number" min={1} max={50} value={newSupplier.sites}
                        onChange={e => setNewSupplier(s => ({ ...s, sites: +e.target.value }))}
                        style={{ width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', borderRadius: 6, color: 'var(--text-pri)', fontSize: 13, boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: 5, fontSize: 12, fontWeight: 500, color: 'var(--text-sec)' }}>Reliability %</label>
                      <input type="number" min={0} max={100} value={newSupplier.reliability}
                        onChange={e => setNewSupplier(s => ({ ...s, reliability: +e.target.value }))}
                        style={{ width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', borderRadius: 6, color: 'var(--text-pri)', fontSize: 13, boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: 5, fontSize: 12, fontWeight: 500, color: 'var(--text-sec)' }}>Proximity (1-10)</label>
                      <input type="number" min={1} max={10} value={newSupplier.proximity_score}
                        onChange={e => setNewSupplier(s => ({ ...s, proximity_score: +e.target.value }))}
                        style={{ width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', borderRadius: 6, color: 'var(--text-pri)', fontSize: 13, boxSizing: 'border-box' }} />
                    </div>
                  </div>

                  <button
                    disabled={updatingSupplier || addingSupplier || !newSupplier.name.trim() || !newSupplier.zone || (newSupplier.zone === 'Other' && !customZone.trim()) || !newSupplier.categories.trim()}
                    onClick={async () => {
                      const resolvedZone = newSupplier.zone === 'Other' ? customZone.trim() : newSupplier.zone
                      const payload = {
                        name: newSupplier.name.trim(),
                        zone: resolvedZone,
                        categories: newSupplier.categories.split(',').map(c => c.trim()).filter(Boolean),
                        buffer_stock_days: newSupplier.buffer_stock_days,
                        sites: newSupplier.sites,
                        reliability: newSupplier.reliability,
                        proximity_score: newSupplier.proximity_score,
                      }

                      if (editingId) {
                        // Update existing supplier
                        setUpdatingSupplier(true)
                        try {
                          await api.updateSupplier(editingId, payload)
                          const refreshed = await api.suppliers()
                          setSuppliers(refreshed.suppliers || refreshed || [])
                          setNewSupplier({ name: '', zone: '', categories: '', buffer_stock_days: 14, sites: 1, reliability: 85, proximity_score: 5 })
                          setCustomZone('')
                          setSupplierFormOpen(false)
                          setEditingId(null)
                          setSuccess('Supplier updated successfully')
                          setTimeout(() => setSuccess(null), 3000)
                        } catch (err) {
                          setError(err.message || 'Failed to update supplier')
                        } finally {
                          setUpdatingSupplier(false)
                        }
                      } else {
                        // Add new supplier
                        setAddingSupplier(true)
                        try {
                          await api.addSupplier(payload)
                          const refreshed = await api.suppliers()
                          setSuppliers(refreshed.suppliers || refreshed || [])
                          setNewSupplier({ name: '', zone: '', categories: '', buffer_stock_days: 14, sites: 1, reliability: 85, proximity_score: 5 })
                          setCustomZone('')
                          setSupplierFormOpen(false)
                          setSuccess('Supplier added successfully')
                          setTimeout(() => setSuccess(null), 3000)
                        } catch (err) {
                          if (isLimitMessage(err.message)) { showUpgrade(err.message) } else { setError(err.message || 'Failed to add supplier') }
                        } finally {
                          setAddingSupplier(false)
                        }
                      }
                    }}
                    style={{
                      alignSelf: 'flex-start',
                      padding: '9px 20px',
                      background: updatingSupplier || addingSupplier ? 'rgba(99,102,241,0.1)' : 'var(--primary)',
                      border: 'none',
                      borderRadius: 6,
                      color: 'white',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: updatingSupplier || addingSupplier ? 'not-allowed' : 'pointer',
                      opacity: (!newSupplier.name.trim() || !newSupplier.zone || !newSupplier.categories.trim()) ? 0.5 : 1
                    }}
                  >
                    {updatingSupplier ? 'Updating...' : addingSupplier ? 'Adding...' : editingId ? 'Save Changes' : 'Add Supplier'}
                  </button>
                </div>
              )}

              {/* Supplier list */}
              {suppliersLoading ? (
                <div style={{ fontSize: 13, color: 'var(--text-dim)', padding: '20px 0' }}>Loading suppliers...</div>
              ) : suppliers.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  padding: '40px 20px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px dashed var(--glass-border)',
                  borderRadius: 8,
                  color: 'var(--text-dim)',
                  fontSize: 13
                }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
                  <div style={{ fontWeight: 500, marginBottom: 4 }}>No suppliers yet</div>
                  <div>Click "+ Add Supplier" above, or use the Bulk Import section to upload an Excel or CSV file.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {suppliers.map((sup, idx) => (
                    <div
                      key={sup.supplier_id || sup.id || idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 14px',
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: 8,
                        transition: 'border-color 0.2s'
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-pri)', marginBottom: 2 }}>{sup.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          <span>📍 {sup.zone}</span>
                          {sup.categories && <span>🏷 {Array.isArray(sup.categories) ? sup.categories.join(', ') : sup.categories}</span>}
                          {sup.buffer_stock_days != null && <span>📦 {sup.buffer_stock_days}d buffer</span>}
                          {sup.reliability != null && <span>✅ {sup.reliability}% reliability</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button
                          disabled={updatingSupplier || editingId === (sup.supplier_id || sup.id)}
                          onClick={() => {
                            const sid = sup.supplier_id || sup.id
                            setEditingId(sid)
                            setNewSupplier({
                              name: sup.name,
                              zone: sup.zone,
                              categories: Array.isArray(sup.categories) ? sup.categories.join(', ') : sup.categories || '',
                              buffer_stock_days: sup.buffer_stock_days || 14,
                              sites: sup.sites || 1,
                              reliability: sup.reliability || 85,
                              proximity_score: sup.proximity_score || 5,
                            })
                            setCustomZone(sup.zone && !VALID_ZONES.includes(sup.zone) ? sup.zone : '')
                            setSupplierFormOpen(true)
                          }}
                          style={{
                            padding: '6px 12px',
                            background: 'transparent',
                            border: '1px solid rgba(99,102,241,0.3)',
                            borderRadius: 6,
                            color: 'var(--primary)',
                            fontSize: 12,
                            cursor: editingId === (sup.supplier_id || sup.id) ? 'not-allowed' : 'pointer',
                            opacity: editingId === (sup.supplier_id || sup.id) ? 0.5 : 1
                          }}
                        >
                          {editingId === (sup.supplier_id || sup.id) ? '...' : '✏️ Edit'}
                        </button>
                        <button
                          disabled={deletingId === (sup.supplier_id || sup.id)}
                          onClick={async () => {
                            const sid = sup.supplier_id || sup.id
                            if (!window.confirm(`Remove ${sup.name}? This supplier will be deleted from your supply chain.`)) return
                            setDeletingId(sid)
                            try {
                              await api.deleteSupplier(sid)
                              setSuppliers(prev => prev.filter(s => (s.supplier_id || s.id) !== sid))
                              setSuccess(`${sup.name} removed successfully`)
                              setTimeout(() => setSuccess(null), 3000)
                            } catch (err) {
                              setError(err.message || 'Failed to delete supplier')
                            } finally {
                              setDeletingId(null)
                            }
                          }}
                          style={{
                            padding: '6px 12px',
                            background: 'transparent',
                            border: '1px solid rgba(239,68,68,0.3)',
                            borderRadius: 6,
                            color: 'var(--danger)',
                            fontSize: 12,
                            cursor: deletingId === (sup.supplier_id || sup.id) ? 'not-allowed' : 'pointer',
                            opacity: deletingId === (sup.supplier_id || sup.id) ? 0.5 : 1
                          }}
                        >
                          {deletingId === (sup.supplier_id || sup.id) ? '...' : '🗑️ Remove'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Onboarding Tab */}
          {activeTab === 'onboarding' && (
            <div style={{ maxWidth: 600 }}>
              {checklist ? (
                <>
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-pri)', marginBottom: 8 }}>
                      Getting Started · {checklist.progress_pct}% complete
                    </div>
                    <div style={{ height: 6, background: 'rgba(255, 255, 255, 0.1)', borderRadius: 4, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${checklist.progress_pct}%`,
                          height: '100%',
                          background: checklist.progress_pct === 100 ? 'var(--success)' : 'var(--primary)',
                          transition: 'width 0.3s ease'
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    {checklist.steps && checklist.steps.map((step, idx) => (
                      <div
                        key={step.id}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 12,
                          paddingBottom: 16,
                          marginBottom: 16,
                          borderBottom: idx === checklist.steps.length - 1 ? 'none' : '1px solid var(--glass-border)'
                        }}
                      >
                        <div
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            background: step.complete ? 'var(--success)' : 'transparent',
                            border: step.complete ? 'none' : '2px solid var(--text-dim)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: step.complete ? 'white' : 'transparent',
                            flexShrink: 0,
                            fontSize: 14,
                            fontWeight: 600
                          }}
                        >
                          {step.complete ? '✓' : ''}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 500,
                              color: 'var(--text-pri)',
                              textDecoration: step.complete ? 'line-through' : 'none',
                              opacity: step.complete ? 0.6 : 1
                            }}
                          >
                            {step.label}
                          </div>
                          {!step.complete && step.action_url && (
                            <a
                              href={step.action_url}
                              style={{
                                display: 'inline-block',
                                marginTop: 4,
                                fontSize: 12,
                                color: 'var(--primary)',
                                textDecoration: 'none',
                                fontWeight: 500,
                                cursor: 'pointer'
                              }}
                            >
                              Go → {step.label}
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Loading checklist...</div>
              )}
            </div>
          )}
        </div>
      </div>

      <UpgradeModal open={upgradeOpen} message={upgradeMsg} onClose={() => setUpgradeOpen(false)} />
    </div>
  )
}
