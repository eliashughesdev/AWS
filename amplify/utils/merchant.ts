import { queryRecord } from './db'

// Owns the system's own customers (direct sign-ups, not onboarded by a merchant).
// Has no API key.
export const SYSTEM_MERCHANT_ID = 'loudibly'

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

export const listMembers = async (merchantId: string) => {
  const result = await queryRecord('v1MerchantTable', 'id = :id AND begins_with(sk, :p)', { ':id': merchantId, ':p': 'MEMBER#' })
  return { success: result.success, res: result.res ?? [] }
}
