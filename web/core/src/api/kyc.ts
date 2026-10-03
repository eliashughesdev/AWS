import { request } from './client'

export function getKycStatus() {
  return request<{ kyc?: { status?: string } }>('/accounts/kyc/status')
}

export function startDiditSession() {
  return request<{ verification_url?: string }>('/accounts/kyc/didit/session', { method: 'POST', body: {} })
}
