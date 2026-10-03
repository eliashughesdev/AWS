import { getCurrentUser, fetchUserAttributes } from './cognito'
import { isWalletUnlocked } from '../wallet/session'
import tracker from '../tracker'

export interface AccessRules {
  requiresAuth?: boolean
  custodialOnly?: boolean
  walletOnly?: boolean
}

// What, if anything, keeps the user off the page. Each app maps these to its own routes.
export type Access = 'allowed' | 'signed-out' | 'needs-cognito' | 'needs-wallet'

// Two ways to be signed in: a Cognito session (custodial) or an unlocked in-memory
// wallet (non-custodial — no server identity at all). Non-custodial users are kept
// out of the custodial-only screens, which all depend on a Cognito token.
export async function checkAccess(rules: AccessRules): Promise<Access> {
  if (!rules.requiresAuth) return 'allowed'

  const hasWallet = isWalletUnlocked()

  // An unlocked wallet is a complete session on its own — a non-custodial user has
  // no Cognito identity, so don't pay for a lookup that is guaranteed to throw.
  if (hasWallet && rules.walletOnly) return 'allowed'

  let hasCognito = false
  try {
    await getCurrentUser()
    const attrs = await fetchUserAttributes()
    if (attrs.email) tracker.setUserID(attrs.email)
    hasCognito = true
  } catch {
    hasCognito = false
  }

  if (!hasCognito && !hasWallet) return 'signed-out'
  if (!hasCognito && rules.custodialOnly) return 'needs-cognito'
  if (rules.walletOnly && !hasWallet) return 'needs-wallet'

  return 'allowed'
}
