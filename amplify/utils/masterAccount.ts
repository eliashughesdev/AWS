import { queryRecord } from './db'
import { SYSTEM_MERCHANT_ID } from './merchant'
import type { KeyRef } from './signing'

export interface MasterAccount {
  depositAddress: string
  key: KeyRef
  vAccountId: string
}

/**
 * A merchant's master for one currency: where its customers' token deposits
 * are swept and the signer of their token withdrawals. Created by
 * provisionMerchantMaster; only a `ready` one is used. An account with no
 * merchant belongs to the system merchant.
 */
export async function getMasterAccount(merchantId: string | undefined, currency: string): Promise<MasterAccount | null> {
  const owner = { merchantId: merchantId ?? SYSTEM_MERCHANT_ID, currency: currency.toUpperCase() }
  const result = await queryRecord(
    'v1MerchantTable',
    'id = :id AND sk = :sk',
    { ':id': owner.merchantId, ':sk': `MASTER#${owner.currency}` }
  )
  const row = result.success ? result.res?.[0] : undefined
  if (row?.status !== 'ready') return null

  const key: KeyRef | null = row.keyModel === 'hd' ? { keyModel: 'hd', owner } : row.kmsKeyId ? { keyModel: 'kms', kmsKeyId: row.kmsKeyId } : null
  if (!key) return null
  return { depositAddress: row.depositAddress, key, vAccountId: row.vAccountId }
}
