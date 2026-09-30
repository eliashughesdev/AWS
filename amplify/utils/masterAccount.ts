import { queryRecord } from './db'
import { SYSTEM_MERCHANT_ID } from './merchant'

export interface MasterAccount {
  depositAddress: string
  kmsKeyId: string
  vAccountId: string
}

/**
 * A merchant's master for one currency: where its customers' token deposits
 * are swept and the signer of their token withdrawals. Created by
 * provisionMerchantMaster; only a `ready` one is used. An account with no
 * merchant belongs to the system merchant.
 */
export async function getMasterAccount(merchantId: string | undefined, currency: string): Promise<MasterAccount | null> {
  const result = await queryRecord(
    'v1MerchantTable',
    'id = :id AND sk = :sk',
    { ':id': merchantId ?? SYSTEM_MERCHANT_ID, ':sk': `MASTER#${currency.toUpperCase()}` }
  )
  const row = result.success ? result.res?.[0] : undefined
  if (row?.status !== 'ready') return null
  return { depositAddress: row.depositAddress, kmsKeyId: row.kmsKeyId, vAccountId: row.vAccountId }
}
