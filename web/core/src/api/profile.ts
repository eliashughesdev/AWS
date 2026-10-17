import { request } from './client'

export function getProfile() {
  return request<{ name?: string }>('/accounts/profile')
}

export function saveProfile(body: { name: string; email: string }) {
  return request('/accounts/profile/save', { method: 'POST', body })
}
