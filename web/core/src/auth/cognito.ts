import { fetchAuthSession } from 'aws-amplify/auth'

// The apps' only door to Cognito. Re-exported unchanged: the views read Amplify's
// result shapes (isSignedIn, nextStep, isSignUpComplete), so new signatures would
// mean rewriting the sign-in and sign-up flows.
export {
  signIn,
  signOut,
  signUp,
  confirmSignUp,
  resendSignUpCode,
  getCurrentUser,
  fetchUserAttributes,
} from 'aws-amplify/auth'

export async function getAccessToken(): Promise<string | undefined> {
  const session = await fetchAuthSession()
  return session.tokens?.accessToken?.toString()
}
