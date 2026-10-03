import { ref } from 'vue'
import { fetchUserAttributes, getCurrentUser } from '../auth/cognito'

// The signed-in Cognito user. load() resolves false when there is no session;
// where to send the user then is the app's call.
export function useCurrentUser() {
  const userEmail   = ref('')
  const displayName = ref('...')
  const userId      = ref('')

  async function load(): Promise<boolean> {
    try {
      const [attrs, user] = await Promise.all([fetchUserAttributes(), getCurrentUser()])
      userEmail.value   = attrs.email ?? ''
      displayName.value = attrs.email?.split('@')[0] ?? 'User'
      userId.value      = user.userId
      return true
    } catch {
      return false
    }
  }

  return { userEmail, displayName, userId, load }
}
