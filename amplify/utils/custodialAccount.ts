import { ProviderRegistry } from './AccountProvider'
import { ProviderName } from '../providers/ledger/ProviderName'
import { CreateAccountParams } from '../providers/ledger/provider'
import { createBlockchainKey } from './awsKms'
import { networkFor } from './currencies'

export interface ProvisionedAccount {
  accountNo: string
  depositAddress: string
  vAccountId: string
  accountRecord: Record<string, any>
  balanceRecord: Record<string, any>
}

/**
 * Creates the external half of a custodial account — KMS key, Tatum virtual
 * account, deposit address and webhook subscription — and returns the records to
 * persist. It deliberately does not write anything, and never touches
 * USERPROFILE: callers put the records in their own transaction so account
 * creation stays atomic with whatever else they are writing.
 *
 * Throws on an unsupported `chain` or any provider failure, leaving nothing in
 * the database.
 */
export const provisionCustodialAccount = async ({ userId, chain, provider, accountingCurrency, merchantId }: {
  userId: string
  chain: string
  provider: ProviderName
  accountingCurrency: string
  merchantId?: string
}): Promise<ProvisionedAccount> => {
  // `chain` is a Tatum ledger currency (TRON, SOL, USDT_TRON); the key and the
  // subscription need the network it settles on.
  const network = networkFor(chain)
  if (!network) throw new Error(`Unsupported ledger currency: ${chain}`)

  const accountNo = provider + crypto.randomUUID().replaceAll('-', '')
  const webhookUrl = process.env.TATUM_WEBHOOK_URL!

  console.log(`PROVISION: ${chain} on ${network} for user ${userId} as ${accountNo}`)

  const { kmsKeyId, address } = await createBlockchainKey(network, accountNo)
  console.log(`PROVISION: KMS key ${kmsKeyId}, address ${address}`)

  const vaProvider = ProviderRegistry.getProvider(provider)

  const vaCreationPayload: CreateAccountParams = {
    userId,
    currency: chain,
    accountingCurrency,
    address,
  }
  const { accountId } = await vaProvider.createVaAccount(vaCreationPayload)
  console.log(`PROVISION: virtual account ${accountId}`)

  const { address: depositAddress } = await vaProvider.assignDepositAddress({ accountId, address })
  const { subscriptionId } = await vaProvider.createSubscription({ accountId, address: depositAddress, chain: network, webhookUrl })
  console.log(`PROVISION: deposit address ${depositAddress}, subscription ${subscriptionId}`)

  const now = Date.now()

  return {
    accountNo,
    depositAddress,
    vAccountId: accountId,
    accountRecord: {
      id: userId,
      sk: `ACCOUNT#${accountNo}`,
      currency: accountingCurrency,
      provider,
      accountNo,
      chain,
      kmsKeyId,
      depositAddress,
      vAccountId: accountId,
      created_at: now,
      fees: 'default',
      providerId: provider || 'default',
      status: 'active',
      merchantId,
    },
    balanceRecord: {
      id: accountId,
      availableBalance: 0.0,
      balance: 0.0,
      created_at: now,
      updated_at: now,
    },
  }
}
