import { getCurrentUser, signIn, signOut } from './cognito'
import { flushPendingProfile } from './pendingProfile'

// Every sign-in goes through here. Amplify refuses to sign in while the browser holds a
// session, even one whose user is gone, so that session is ended first.
export async function startSession(email: string, password: string) {
  try {
    return await signIn({ username: email, password })
  } catch (e: unknown) {
    if ((e as Error).name !== 'UserAlreadyAuthenticatedException') throw e
    await signOut()
    return signIn({ username: email, password })
  }
}

// Resolves false when Cognito wants another step before the session starts.
export async function signInWithPassword(email: string, password: string): Promise<boolean> {
  const { isSignedIn } = await startSession(email, password)
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
