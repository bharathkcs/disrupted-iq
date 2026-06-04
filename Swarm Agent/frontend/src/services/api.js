import { authHelpers } from './auth.js'

const BASE = import.meta.env.VITE_API_BASE || ''

function getAuthHeaders() {
  const headers = {}
  // On /demo/* routes never send the real JWT — use demo session only.
  // Prevents a logged-in user's real supplier data leaking into the public demo.
  const isDemoRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/demo')

  if (!isDemoRoute) {
    const token = authHelpers.getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  } else {
    const demoSessionId = authHelpers.getDemoSessionId()
    if (demoSessionId) headers['X-Demo-Session'] = demoSessionId
  }
  return headers
}

async function request(path, opts = {}) {
  // On /demo routes, never send cookies — a stale auth_token cookie from a
  // previous real-client login would otherwise auto-authenticate the demo
  // session as that real client, leaking their supplier list into the demo.
  const isDemoRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/demo')
  const response = await fetch(BASE + path, {
    credentials: isDemoRoute ? 'omit' : 'include',
    headers: {
      ...(!(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...getAuthHeaders(),
      ...(opts.headers || {}),
    },
    ...opts,
  })

  if (!response.ok) {
    let msg = `${response.status} ${response.statusText}`
    let detail = null
    try {
      const json = await response.json()
      detail = json.detail
      msg = json.detail || json.message || JSON.stringify(json)
    } catch {
      const text = await response.text().catch(() => '')
      if (text) msg = text
    }
    if (response.status === 403 && detail === 'ACCOUNT_SUSPENDED') {
      window.dispatchEvent(new CustomEvent('account-suspended', { detail: msg }))
    }
    throw new Error(msg)
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return response.json()
  if (contentType.includes('application/zip') || contentType.includes('spreadsheetml')) return response.blob()
  return response.text()
}

async function downloadFile(path) {
  return request(path)
}

export const api = {
  request: (path, opts = {}) => request(path, opts),
  health: () => request('/health'),
  config: () => request('/api/config'),
  updateConfig: body => request('/api/config/update', { method: 'POST', body: JSON.stringify(body) }),
  configHistory: () => request('/api/config/history'),

  signup: body => request('/api/auth/signup', { method: 'POST', body: JSON.stringify(body) }),
  login: body => request('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  logoutAll: () => request('/api/auth/logout-all', { method: 'POST' }),
  getCurrentUser: () => request('/api/auth/me'),
  listSessions: () => request('/api/auth/sessions'),
  revokeSession: jti => request(`/api/auth/sessions/${jti}`, { method: 'DELETE' }),
  forgotPassword: body => request('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify(body) }),
  verifyResetToken: body => request('/api/auth/verify-reset-token', { method: 'POST', body: JSON.stringify(body) }),
  resetPassword: body => request('/api/auth/reset-password', { method: 'POST', body: JSON.stringify(body) }),
  changePassword: body => request('/api/auth/change-password', { method: 'POST', body: JSON.stringify(body) }),
  updateCompanyDetails: body => request('/api/auth/update-company', { method: 'POST', body: JSON.stringify(body) }),
  updateProfile: body => request('/api/auth/update-profile', { method: 'PUT', body: JSON.stringify(body) }),

  importSuppliers: body => request('/api/auth/import-suppliers', { method: 'POST', body: JSON.stringify(body) }),
  downloadSupplierTemplate: () => downloadFile('/api/suppliers/template'),
  uploadSupplierExcel: async file => {
    const formData = new FormData()
    formData.append('file', file)
    return request('/api/suppliers/upload-excel', { method: 'POST', body: formData })
  },
  uploadSupplierCsv: async file => {
    const formData = new FormData()
    formData.append('file', file)
    return request('/api/suppliers/upload-csv', { method: 'POST', body: formData })
  },

  suppliers: () => request('/api/suppliers'),
  addSupplier: body => request('/api/suppliers/add-single', { method: 'POST', body: JSON.stringify(body) }),
  updateSupplier: (id, body) => {
    if (typeof id === 'object' && id?.supplier_id) {
      return request('/api/config/suppliers/update', { method: 'POST', body: JSON.stringify(id) })
    }
    return request(`/api/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(body) })
  },
  deleteSupplier: id => request(`/api/suppliers/${id}`, { method: 'DELETE' }),
  bulkDeleteSuppliers: supplierIds => request('/api/suppliers/bulk-delete', { method: 'POST', body: JSON.stringify({ supplier_ids: supplierIds }) }),
  exportSuppliers: () => downloadFile('/api/suppliers/export'),
  supplierHealthScores: () => request('/api/suppliers/health-scores'),
  compareSuppliers: ids => request(`/api/suppliers/compare?ids=${encodeURIComponent(ids.join(','))}`),
  supplierTrends: () => request('/api/suppliers/trends'),
  supplierAnomalies: () => request('/api/suppliers/anomalies'),

  getScenarios: () => request('/api/scenarios'),
  createScenario: body => request('/api/scenarios', { method: 'POST', body: JSON.stringify(body) }),
  deleteScenario: id => request(`/api/scenarios/${id}`, { method: 'DELETE' }),
  search: (q, types = 'events,suppliers,audit', limit = 20) =>
    request(`/api/search?q=${encodeURIComponent(q)}&types=${types}&limit=${limit}`),

  accountExport: () => downloadFile('/api/account/export-data'),
  accountResetData: confirm => request('/api/account/reset-data', { method: 'POST', body: JSON.stringify({ confirm }) }),
  requestAccountDelete: (reason, reasonLabel) => request('/api/account/delete', { method: 'POST', body: JSON.stringify({ reason: reason || '', reason_label: reasonLabel || '' }) }),
  confirmAccountDelete: token => request('/api/account/confirm-delete', { method: 'POST', body: JSON.stringify({ token }) }),
  getNotificationSettings: () => request('/api/account/notifications'),
  updateNotificationSettings: body => request('/api/account/notifications', { method: 'PUT', body: JSON.stringify(body) }),
  sendTestEmail: () => request('/api/account/test-email', { method: 'POST' }),

  notifications: () => request('/api/notifications'),
  markNotificationRead: id => request(`/api/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () => request('/api/notifications/read-all', { method: 'POST' }),
  deleteNotification: id => request(`/api/notifications/${id}`, { method: 'DELETE' }),

  onboardingChecklist: () => request('/api/onboarding/checklist'),
  completeOnboardingStep: stepId => request(`/api/onboarding/checklist/${stepId}`, { method: 'PUT', body: JSON.stringify({ complete: true }) }),

  triggerEvent: body => request('/api/events/trigger', { method: 'POST', body: JSON.stringify(body) }),
  triggerChaosMode: () => request('/api/demo/chaos-mode', { method: 'POST' }),
  getEvent: id => request(`/api/events/${id}`),
  listEvents: () => request('/api/events'),
  acknowledge: body => request('/api/events/acknowledge', { method: 'POST', body: JSON.stringify(body) }),
  hilConfirm: body => request('/api/events/hil-confirm', { method: 'POST', body: JSON.stringify(body) }),
  nlQuery: body => request('/api/events/nl-query', { method: 'POST', body: JSON.stringify(body) }),
  resolve: body => request('/api/events/resolve', { method: 'POST', body: JSON.stringify(body) }),
  supplierMessage: body => request('/api/events/supplier-message', { method: 'POST', body: JSON.stringify(body) }),
  riskChanges: eventId => request(`/api/events/${eventId}/risk-changes`),

  nlQueries: id => request(`/api/nl-queries/${id}`),
  auditLog: eventId => request(`/api/audit-log${eventId ? `?event_id=${encodeURIComponent(eventId)}` : ''}`),
  auditLogExport: () => request('/api/audit-log/export'),
  memory: () => request('/api/memory'),
  counterfactuals: () => request('/api/counterfactuals'),

  demoScenarios: () => request('/api/demo-scenarios'),
  triggerDemoScenario: scenarioId => request(`/api/demo-scenarios/${scenarioId}/trigger`, { method: 'POST' }),
  newsLatest: () => request('/api/news/latest'),
  weatherCurrent: () => request('/api/weather/current'),
  reportsSummary: () => request('/api/reports/summary'),
  supplyChainMap: () => request('/api/supply-chain-map'),
  resilienceScore: () => request('/api/resilience-score'),
  getDisruptionRisk: () => request('/api/disruption-risk'),
  predictedDisruptions: () => request('/api/threat-intelligence'),
  dataQuality: () => request('/api/data-quality'),
  dependencyHeatmap: () => request('/api/dependency-heatmap'),
  reportEventLog: params => request(`/api/reports/r01-event-log${params ? `?${new URLSearchParams(params)}` : ''}`),
  reportSwarmPerformance: () => request('/api/reports/r02-swarm-performance'),
  reportMemoryAccuracy: () => request('/api/reports/r03-memory-accuracy'),
  reportDissent: () => request('/api/reports/r04-dissent-detection'),
  reportSimulation: () => request('/api/reports/r05-simulation-accuracy'),
  reportCascade: () => request('/api/reports/r06-cascade-detection'),
  reportCounterfactual: () => request('/api/reports/r07-counterfactual-summary'),
  reportHilDecisions: () => request('/api/reports/r08-hil-decisions'),
  reportForecastAccuracy: () => request('/api/reports/r09-forecast-risk-accuracy'),
  reportCompliance: () => request('/api/reports/r10-compliance'),

  submitFeedback: body => request('/api/feedback', { method: 'POST', body: JSON.stringify(body) }),
  submitSupportRequest: body => request('/api/support', { method: 'POST', body: JSON.stringify(body) }),
  submitSurvey: body => request('/api/survey', { method: 'POST', body: JSON.stringify(body) }),

  adminOverview: () => request('/api/admin/overview'),
  adminUsers: () => request('/api/admin/users'),
  adminActivity: (limit = 200) => request(`/api/admin/activity?limit=${limit}`),
  adminAiInteractions: (limit = 200) => request(`/api/admin/ai-interactions?limit=${limit}`),
  adminSystemHealth: () => request('/api/admin/system-health'),
  adminSuspendUser: clientId => request(`/api/admin/users/${encodeURIComponent(clientId)}/suspend`, { method: 'POST' }),
  adminReactivateUser: clientId => request(`/api/admin/users/${encodeURIComponent(clientId)}/reactivate`, { method: 'POST' }),

  requestPremium: () => request('/api/account/request-premium', { method: 'POST' }),
  adminPremiumRequests: () => request('/api/admin/premium-requests'),
  adminApprovePremium: id => request(`/api/admin/premium-requests/${encodeURIComponent(id)}/approve`, { method: 'POST' }),
  adminDenyPremium: id => request(`/api/admin/premium-requests/${encodeURIComponent(id)}/deny`, { method: 'POST' }),
  adminSupport: () => request('/api/admin/support'),
  adminFeedback: () => request('/api/admin/feedback'),
  adminRevokePremium: clientId => request(`/api/admin/users/${encodeURIComponent(clientId)}/revoke-premium`, { method: 'POST' }),
  adminGrantPremium: clientId => request(`/api/admin/users/${encodeURIComponent(clientId)}/grant-premium`, { method: 'POST' }),
  adminRespondSupport: (ticketId, body) => request(`/api/admin/support/${encodeURIComponent(ticketId)}/respond`, { method: 'POST', body: JSON.stringify(body) }),
  adminDeleteAccount: clientId => request(`/api/admin/users/${encodeURIComponent(clientId)}/delete`, { method: 'POST' }),
  adminDeletedAccounts: () => request('/api/admin/deleted-accounts'),
  adminRestoreAccount: clientId => request(`/api/admin/deleted-accounts/${encodeURIComponent(clientId)}/restore`, { method: 'POST' }),
  adminSelfDeletions: () => request('/api/admin/self-deletions'),
  adminSurveys: () => request('/api/admin/surveys'),

  // Section 1 Sprint — proactive auto-monitoring
  getMonitorConfig: () => request('/api/monitor/config'),
  updateMonitorConfig: body => request('/api/monitor/config', { method: 'PUT', body: JSON.stringify(body) }),

  // Section 2 Sprint — supplier financial health
  supplierFinancialHealth: () => request('/api/suppliers/financial-health'),

  // Section 3 Sprint — Tier-2 probabilistic dependency inference
  tier2Visibility: () => request('/api/supply-chain/tier2'),

  // Section 4 Sprint — ESG & Compliance risk
  supplierEsg: () => request('/api/suppliers/esg'),

  // Section 5 Sprint — federated baseline memory (anonymised)
  federatedBaseline: (eventType, geography) =>
    request(`/api/memory/federated-baseline?event_type=${encodeURIComponent(eventType)}&geography=${encodeURIComponent(geography)}`),

  // Section 7 Sprint — daily disruption-risk briefing history
  briefingHistory: (days = 30) => request(`/api/briefing/history?days=${days}`),

  // Section 8 Sprint — cross-industry benchmark strip
  industryBenchmark: () => request('/api/benchmarks/industry'),
}

export { authHelpers }
export const SOCKET_URL = BASE || window.location.origin
