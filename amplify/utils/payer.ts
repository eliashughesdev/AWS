import { queryRecord } from './db'
import { processError } from '../errors/http'

type Authorizer = { userId?: string, role?: string, authType?: string, merchantId?: string } | undefined

export type PayerCheck =
  | { userId: string, error?: never }
  | { userId?: never, error: ReturnType<typeof processError> }

const notYours = () => ({ error: processError(100053, undefined, 403) })

/**
 * Whose cards a card route acts on (pci-remediation-plan.md F3); the request's userId is only
 * ever a claim to check:
 * - a signed-in user: themselves. A userId naming anyone else is refused, not ignored, so a
 *   confused client hears about it.
 * - a merchant's key: the userId it names, which must be one of its own users (USERPROFILE
 *   merchantId). A user that does not exist gets the same 100053, so a merchant cannot learn
 *   which ids are real.
 * - anyone else (staff, a merchant's team, the Cognito group admin): refused.
 */
export const resolvePayer = async (authorizer: Authorizer, requestedUserId: unknown): Promise<PayerCheck> => {
  if (authorizer?.authType === 'jwt' && authorizer.role === 'user' && authorizer.userId) {
    if (requestedUserId !== undefined && requestedUserId !== authorizer.userId) return notYours()
    return { userId: authorizer.userId }
  }

  if (authorizer?.authType === 'key' && authorizer.role === 'admin' && authorizer.merchantId) {
    if (typeof requestedUserId !== 'string' || !requestedUserId) return { error: processError(100029, 'userId') }

    const profile = await queryRecord('v2CustomerTable', 'id = :id AND sk = :sk', { ':id': requestedUserId, ':sk': 'USERPROFILE' })
    if (!profile.success) {
      console.error('ERROR: The payer\'s profile could not be read')
      return { error: processError(100002, 'the user could not be checked') }
    }
    if (profile.res?.[0]?.merchantId !== authorizer.merchantId) return notYours()
    return { userId: requestedUserId }
  }

  return notYours()
}
