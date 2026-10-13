import { queryRecord } from './db'
import { processError } from '../errors/http'

export { SYSTEM_MERCHANT_ID } from './systemMerchant'

export const MEMBER_ROLES = ['initiator', 'approver']

const getRow = async (id: string, sk: string) => {
  const result = await queryRecord('v1MerchantTable', 'id = :id AND sk = :sk', { ':id': id, ':sk': sk })
  return { success: result.success, res: result.res?.[0] ?? null }
}

/** A merchant's PROFILE row; `res` is null when the merchant doesn't exist. */
export const getMerchant = (merchantId: string) => getRow(merchantId, 'PROFILE')

/** Which merchant a team member belongs to — one per person; null when none. */
export const getMembership = (userId: string) => getRow(`USER#${userId}`, 'MEMBERSHIP')

/** A team member's MEMBER# row: roles and status live only here. */
export const getMember = (merchantId: string, userId: string) => getRow(merchantId, `MEMBER#${userId}`)

export type MemberCheck =
  | { merchantId: string, error?: never }
  | { merchantId?: never, error: ReturnType<typeof processError> }

/**
 * The merchant a team member acts for: their own, found from the caller and never
 * from the request. Refuses a caller with no active membership (100042) and a
 * merchant that is not active (100040).
 */
export const resolveMember = async (userId: string): Promise<MemberCheck> => {
  const membership = await getMembership(userId)
  if (!membership.success) return { error: processError(100003) }
  if (!membership.res) return { error: processError(100042) }
  const merchantId: string = membership.res.merchantId

  const [member, merchant] = await Promise.all([getMember(merchantId, userId), getMerchant(merchantId)])
  if (!member.success || !merchant.success) return { error: processError(100003) }
  if (member.res?.status !== 'active') return { error: processError(100042) }
  if (merchant.res?.status !== 'active') return { error: processError(100040) }
  return { merchantId }
}

export const listMembers = async (merchantId: string) => {
  const result = await queryRecord('v1MerchantTable', 'id = :id AND begins_with(sk, :p)', { ':id': merchantId, ':p': 'MEMBER#' })
  return { success: result.success, res: result.res ?? [] }
}
