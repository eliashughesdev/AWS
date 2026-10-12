import { ref } from 'vue'
import { confirmSignUp, resendSignUpCode, signUp } from '../auth/cognito'
import { startSession } from '../auth/signIn'
import { flushPendingProfile, rememberPendingProfile } from '../auth/pendingProfile'

// 0 (empty) to 4: one point each for length, an upper-case letter, a digit and a symbol.
export function passwordStrength(password: string): number {
  if (!password) return 0
  let score = 0
  if (password.length >= 8) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++
  return score
}

// Confirms an email address. The emailed link and the in-app code both work, and
// Cognito refuses whichever comes second — that counts as confirmed too.
export async function confirmEmail(email: string, code: string): Promise<boolean> {
  try {
    const { isSignUpComplete } = await confirmSignUp({ username: email, confirmationCode: code })
    return isSignUpComplete
  } catch (e: unknown) {
    const msg = (e as Error).message ?? ''
    if (!msg.includes('Current status is CONFIRMED')) throw e
    return true
  }
}

// Sign-up with an emailed code. Errors from Cognito are thrown as they come.
export function useSignUp() {
  // Kept in memory to sign the user in once the email is confirmed.
  const pendingEmail = ref('')
  let pendingPassword = ''

  // Resolves true when Cognito is waiting for the emailed code.
  async function register({ email, password, firstName, lastName }: {
    email: string
    password: string
    firstName: string
    lastName: string
  }) {
    const { nextStep } = await signUp({
      username: email,
      password,
      options: { userAttributes: { email } },
    })
    if (nextStep.signUpStep !== 'CONFIRM_SIGN_UP') return false

    pendingEmail.value = email
    pendingPassword    = password
    rememberPendingProfile({ name: `${firstName} ${lastName}`.trim(), email })
    return true
  }

  // Resolves true when the user ends up signed in.
  async function confirm(code: string) {
    if (!(await confirmEmail(pendingEmail.value, code))) return false
    await startSession(pendingEmail.value, pendingPassword)
    await flushPendingProfile()
    return true
  }

  function resend() {
    return resendSignUpCode({ username: pendingEmail.value })
  }

  return { pendingEmail, register, confirm, resend }
}
