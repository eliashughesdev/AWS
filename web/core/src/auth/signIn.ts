import { getCurrentUser, signIn } from './cognito'
import { flushPendingProfile } from './pendingProfile'

// Resolves false when Cognito wants another step before the session starts.
export async function signInWithPassword(email: string, password: string): Promise<boolean> {
  const { isSignedIn } = await signIn({ username: email, password })
  if (isSignedIn) await flushPendingProfile()
  return isSignedIn
}

export async function isSignedIn(): Promise<boolean> {
  try {
    await getCurrentUser()
    return true
  } catch {
    return false
  }
}
