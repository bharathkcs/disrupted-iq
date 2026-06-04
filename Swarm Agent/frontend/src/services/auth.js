export const authHelpers = {
  getToken() {
    return sessionStorage.getItem('auth_token') || ''
  },
  getClientId() {
    return sessionStorage.getItem('client_id') || ''
  },
  getDemoSessionId() {
    // If the user picked a specific demo client from the landing page, use that
    // as the X-Demo-Session value so the backend loads the matching seed
    // suppliers/scenarios. Defaults to global_demo for a multi-continent first
    // impression.
    const chosen = sessionStorage.getItem('demo_client_id')
    if (chosen) return chosen
    let sessionId = sessionStorage.getItem('demo_session_id')
    if (!sessionId) {
      const randomBytes = new Uint8Array(12)
      crypto.getRandomValues(randomBytes)
      const hexString = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('')
      sessionId = `demo_${hexString}_${Date.now()}`
      sessionStorage.setItem('demo_session_id', sessionId)
    }
    return sessionId
  },
  getCompanyName() {
    return sessionStorage.getItem('company_name') || ''
  },
  getEmail() {
    return sessionStorage.getItem('email') || ''
  },
  isLoggedIn() {
    return !!this.getClientId()
  },
  saveAuth(clientId, companyName, email, token) {
    sessionStorage.setItem('client_id', clientId)
    sessionStorage.setItem('company_name', companyName)
    if (email) sessionStorage.setItem('email', email)
    if (token) sessionStorage.setItem('auth_token', token)
  },
  clearAuth() {
    sessionStorage.removeItem('client_id')
    sessionStorage.removeItem('company_name')
    sessionStorage.removeItem('email')
    sessionStorage.removeItem('auth_token')
    sessionStorage.removeItem('demo_session_id')
    sessionStorage.removeItem('demo_client_id')
  },
}
