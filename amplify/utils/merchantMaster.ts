import { putItem, queryRecord, updateItem } from './db'
import { createBlockchainKey } from './awsKms'
import { networkFor } from './currencies'
import { ProviderRegistry } from './AccountProvider'
import { ProviderName } from '../providers/ledger/ProviderName'
import { custodyKeyModel } from './config'
import { allocateAddress, createSeed } from './hdSigner'

const TABLE = 'v1MerchantTable'

const loadRow = async (merchantId: string, sk: string) => {
  const result = await queryRecord(TABLE, 'id = :id AND sk = :sk', { ':id': merchantId, ':sk': sk })
  if (!result.success) throw new Error(`Failed to read ${sk} for merchant ${merchantId}`)
  return result.res?.[0] ?? null
}

// Saves a finished step on the MASTER# row. `onlyIfMissing` makes a racing call
// fail here instead of overwriting what the other one created.
const saveStep = async (merchantId: string, currency: string, values: Record<string, any>, onlyIfMissing?: string) => {
  const keys = Object.keys(values)
  const result = await updateItem({
    tableName: TABLE,
    key: { id: merchantId, sk: `MASTER#${currency}` },
    updateExpression: 'SET ' + keys.map(k => `#${k} = :${k}`).join(', '),
    conditionExpression: onlyIfMissing ? `attribute_not_exists(#${onlyIfMissing})` : undefined,
    attributeNames: Object.fromEntries(keys.map(k => [`#${k}`, k])),
    attributeValues: Object.fromEntries(keys.map(k => [`:${k}`, values[k]])),
  })
  if (!result.success) {
    throw new Error(`Failed to save ${keys.join(', ')} on MASTER#${currency} for ${merchantId}: ${JSON.stringify(values)} may be orphaned`, { cause: result.error })
  }
}

/**
 * Provisions everything a merchant needs to hold one currency: the master
 * (its key, by custodyKeyModel: a KMS key or an address under the merchant's
 * seed; a Tatum VA with that address assigned) and a ledger-only fee VA.
 */
export async function provisionMerchantMaster(merchantId: string, currency: string, accountingCurrency: string) {
  const network = networkFor(currency)
  if (!network) throw new Error(`Unsupported ledger currency: ${currency}`)

  const sk = `MASTER#${currency}`
  const claimed = { id: merchantId, sk, currency, status: 'provisioning', createdAt: new Date().toISOString() }
  const claim = await putItem(TABLE, claimed, 'attribute_not_exists(sk)')

  let row: Record<string, any> | null = claimed
  if (!claim.success) {
    if (claim.error?.name !== 'ConditionalCheckFailedException') throw new Error(`Failed to claim ${sk} for ${merchantId}`, { cause: claim.error })
    row = await loadRow(merchantId, sk)
    if (!row) throw new Error(`${sk} for ${merchantId} is being provisioned by another request — retry`)
  }
  if (row.status === 'ready') return row

  const provider = ProviderRegistry.getProvider(ProviderName.Tatum)

  if (!row.depositAddress) {
    let key: Record<string, any>
    if (custodyKeyModel() === 'hd') {
      // The merchant may predate seeds, or its seed may not have finished at registration
      await createSeed(merchantId, network)
      const { derivationIndex, address } = await allocateAddress(merchantId, network)
      key = { keyModel: 'hd', derivationIndex, depositAddress: address }
    } else {
      const { kmsKeyId, address } = await createBlockchainKey(network, `master-${merchantId}-${currency}`)
      key = { kmsKeyId, depositAddress: address }
    }
    await saveStep(merchantId, currency, key, 'depositAddress')
    row = { ...row, ...key }
  }

  if (!row.vAccountId) {
    const { accountId } = await provider.createVaAccount({ userId: merchantId, currency, accountingCurrency })
    await saveStep(merchantId, currency, { vAccountId: accountId }, 'vAccountId')
    row = { ...row, vAccountId: accountId }
  }

  if (!row.assigned) {
    await provider.assignDepositAddress({ accountId: row.vAccountId, address: row.depositAddress })
    await saveStep(merchantId, currency, { assigned: true })
  }

  const feeVa = await loadRow(merchantId, `FEEVA#${currency}`)
  if (!feeVa) {
    const { accountId } = await provider.createVaAccount({ userId: merchantId, currency, accountingCurrency })
    const saved = await putItem(TABLE, { id: merchantId, sk: `FEEVA#${currency}`, currency, vAccountId: accountId, createdAt: new Date().toISOString() }, 'attribute_not_exists(sk)')
    if (!saved.success) throw new Error(`Failed to save FEEVA#${currency} for ${merchantId}: VA ${accountId} may be orphaned`, { cause: saved.error })
  }

  await saveStep(merchantId, currency, { status: 'ready' })
  console.log(`MERCHANT_MASTER: ${currency} ready for ${merchantId}, master ${row.depositAddress}`)
  return { ...row, status: 'ready' }
}
