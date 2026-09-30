import { queryRecord } from './db'

// Owns the system's own customers (direct sign-ups, not onboarded by a merchant).
// Has no API key.
export const SYSTEM_MERCHANT_ID = 'loudibly'

/** A merchant's PROFILE row; `res` is null when the merchant doesn't exist. */
export const getMerchant = async (merchantId: string) => {
  const result = await queryRecord(
    'v1MerchantTable',
    'id = :id AND sk = :sk',
    { ':id': merchantId, ':sk': 'PROFILE' }
  )
  return { success: result.success, res: result.res?.[0] ?? null }
}
