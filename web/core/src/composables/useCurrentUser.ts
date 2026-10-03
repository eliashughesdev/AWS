import { ref } from 'vue'
import { fetchUserAttributes, getCurrentUser } from '../auth/cognito'
import { getProfile } from '../api/profile'

// The signed-in user. load() resolves false when there is no Cognito session;
// where to send the user then is the app's call.
export function useCurrentUser() {
  const userEmail   = ref('')
  const displayName = ref('...')
  const userId      = ref('')

  async function load(): Promise<boolean> {
    try {
      const [attrs, user, profile] = await Promise.all([
        fetchUserAttributes(),
        getCurrentUser(),
        // A failed profile lookup must not read as "signed out" — fall back to the email.
        getProfile().catch(() => null),
      ])
      // The name lives in the database (USERPROFILE.name); Cognito only holds the email.
      const profileName = profile?.ok ? profile.data.name : undefined
      userEmail.value   = attrs.email ?? ''
      displayName.value = profileName || (attrs.email?.split('@')[0] ?? 'User')
      userId.value      = user.userId
      return true
    } catch {
      return false
    }
  }

  return { userEmail, displayName, userId, load }
}
