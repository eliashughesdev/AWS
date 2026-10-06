import { ref } from 'vue'
import { claimAccount, verifyClaimToken } from '../api/onboarding'
import { signIn } from '../auth/cognito'

// Error codes for a link that can't be used again: expired, or already used.
const SPENT_LINK = [100035, 100036]

// Setting a first password from the emailed claim link. The link's one-time token is
// the only credential; it is held in memory only.
export function useClaim() {
  let token = ''
  const email     = ref('')
  const firstName = ref('')

  // Throws when the request itself fails.
  async function verify(linkToken: string): Promise<{ ok: true } | { ok: false; message?: string }> {
    token = linkToken
    const { ok, data } = await verifyClaimToken(token)
    if (!ok) return { ok: false, message: data?.message }

    email.value     = data?.res?.data?.email ?? ''
    firstName.value = data?.res?.data?.firstName ?? ''
    return { ok: true }
  }

  // Sets the password, then signs in. Throws when a request itself fails, including
  // the sign-in that follows a password that was set.
  async function setPassword(password: string): Promise<{ ok: true } | { ok: false; message?: string; linkSpent: boolean }> {
    const { ok, data } = await claimAccount(token, password)
    if (!ok) {
      return { ok: false, message: data?.message, linkSpent: SPENT_LINK.includes(data?.error_code ?? 0) }
    }

    await signIn({ username: email.value, password })
    return { ok: true }
  }

  return { email, firstName, verify, setPassword }
}
