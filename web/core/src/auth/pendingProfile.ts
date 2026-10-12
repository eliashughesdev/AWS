import { saveProfile } from '../api/profile'
import { fetchUserAttributes, getAccessToken } from './cognito'

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
    // Whoever signed up in this browser may not be who just signed in
    const signedIn = (await fetchUserAttributes()).email ?? ''
    if (signedIn.toLowerCase() !== String(email).toLowerCase()) return
    // A refused save keeps the name for the next sign-in
    const { ok } = await saveProfile({ name, email })
    if (ok) localStorage.removeItem(KEY)
  } catch (e) {
    console.error('Failed to save pending profile', e)
  }
}
