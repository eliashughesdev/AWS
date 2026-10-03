import { request } from './client'

// Called from the emailed claim link, before the payer has a password — no session yet.

export function verifyClaimToken(token: string) {
  return request<{ res?: { data?: { email?: string; firstName?: string } } }>('/onboarding/verify', {
    method: 'POST',
    body: { token },
    auth: false,
  })
}

export function claimAccount(token: string, password: string) {
  return request('/onboarding/claim', { method: 'POST', body: { token, password }, auth: false })
}
