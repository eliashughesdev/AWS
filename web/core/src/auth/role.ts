import { getAccessTokenGroups } from './cognito'

export type Role = 'staff' | 'admin' | 'merchant' | 'user'

// Same precedence as the API's authorizer (amplify/fn/authorizer/handler.js).
export function roleFromGroups(groups: string[]): Role {
  if (groups.includes('staff')) return 'staff'
  if (groups.includes('admin')) return 'admin'
  if (groups.includes('merchant')) return 'merchant'
  return 'user'
}

// The role the API gives this session: both read the token that request() sends.
// It only says what to show; the API checks the role itself. A group given after
// sign-in is not in the token until it is renewed. Undefined when there is no session.
export async function getRole(): Promise<Role | undefined> {
  const groups = await getAccessTokenGroups()
  return groups && roleFromGroups(groups)
}
