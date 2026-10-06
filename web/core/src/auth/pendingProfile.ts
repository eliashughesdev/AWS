import { saveProfile } from '../api/profile'
import { getAccessToken } from './cognito'

const KEY = 'loudibly.pendingProfile'

// The name typed at sign-up can only be saved once a session exists. It waits in
// localStorage because link-based confirmation happens in a new tab with fresh state.
export function rememberPendingProfile(profile: { name: string; email: string }) {
  localStorage.setItem(KEY, JSON.stringify(profile))
}

export async function flushPendingProfile() {
  const raw = localStorage.getItem(KEY)
  if (!raw) return
  try {
    const { name, email } = JSON.parse(raw)
    if (!(await getAccessToken()) || !name) return
    await saveProfile({ name, email })
    localStorage.removeItem(KEY)
  } catch (e) {
    console.error('Failed to save pending profile', e)
  }
}
