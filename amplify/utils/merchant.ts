import { queryRecord } from './db'

/** A merchant's PROFILE row; `res` is null when the merchant doesn't exist. */
export const getMerchant = async (merchantId: string) => {
  const result = await queryRecord(
    'v1MerchantTable',
    'id = :id AND sk = :sk',
    { ':id': merchantId, ':sk': 'PROFILE' }
  )
  return { success: result.success, res: result.res?.[0] ?? null }
}
