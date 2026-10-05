import { ProviderRegistry } from './AccountProvider'
import { ProviderName } from '../providers/ledger/ProviderName'
import { createBlockchainKey, scheduleKeyDeletion } from './awsKms'
import { networkFor } from './currencies'

export interface ProvisionedAccount {
  accountNo: string
  depositAddress: string
  vAccountId: string
  kmsKeyId: string
  subscriptionId: string
  accountRecord: Record<string, any>
  balanceRecord: Record<string, any>
}

type Created = Partial<Pick<ProvisionedAccount, 'vAccountId' | 'kmsKeyId' | 'depositAddress' | 'subscriptionId'>>

const undo = async (what: string, step: () => Promise<void>) => {
  try {
    await step()
    console.log(`PROVISION_UNDO: ${what}`)
  } catch (err) {
    console.error(`PROVISION_UNDO_FAILED: ${what}, left orphaned: ${(err as Error).message}`)
  }
}

// Newest first. Each step is best effort, so one failure doesn't strand the rest.
const undoProvisioning = async (provider: ProviderName, { vAccountId, kmsKeyId, depositAddress, subscriptionId }: Created) => {
  const vaProvider = ProviderRegistry.getProvider(provider)
  if (subscriptionId) await undo(`cancel subscription ${subscriptionId}`, () => vaProvider.cancelSubscription(subscriptionId))
  if (vAccountId && depositAddress) await undo(`remove address ${depositAddress} from virtual account ${vAccountId}`, () => vaProvider.removeDepositAddress({ accountId: vAccountId, address: depositAddress }))
  if (vAccountId) await undo(`deactivate virtual account ${vAccountId}`, () => vaProvider.deactivateVaAccount(vAccountId))
  if (kmsKeyId) await undo(`schedule deletion of KMS key ${kmsKeyId}`, () => scheduleKeyDeletion(kmsKeyId))
}

/**
 * For a caller whose own write failed after provisioning. A write DynamoDB
 * rejected was never applied, so the account's resources are removed. After a
 * timeout or a 5xx it may have been applied, so they are only reported.
 */
export const discardProvisionedAccount = async (provider: ProviderName, account: ProvisionedAccount, writeError: any) => {
  if (writeError?.$fault === 'client') return undoProvisioning(provider, account)
  console.error(`PROVISION_UNDO_SKIPPED: write outcome unknown for ${account.accountNo}; virtual account ${account.vAccountId}, KMS key ${account.kmsKeyId} and subscription ${account.subscriptionId} may be orphaned`)
}

/**
 * Creates the external half of a custodial account — Tatum virtual account, KMS
 * key, deposit address and webhook subscription — and returns the records to
 * persist. It deliberately does not write anything, and never touches
 * USERPROFILE: callers put the records in their own transaction so account
 * creation stays atomic with whatever else they are writing. A caller whose
 * write then fails must call discardProvisionedAccount.
 *
 * Throws on an unsupported `chain` or any provider failure, after undoing what
 * it had created, leaving nothing in the database.
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

  const vaProvider = ProviderRegistry.getProvider(provider)
  const created: Created = {}

  try {
    // The virtual account comes before the key: it needs no address, so a
    // request Tatum rejects fails here with nothing to undo.
    const { accountId } = await vaProvider.createVaAccount({ userId, currency: chain, accountingCurrency })
    created.vAccountId = accountId
    console.log(`PROVISION: virtual account ${accountId}`)

    const { kmsKeyId, address } = await createBlockchainKey(network, accountNo)
    created.kmsKeyId = kmsKeyId
    console.log(`PROVISION: KMS key ${kmsKeyId}, address ${address}`)

    const { address: depositAddress } = await vaProvider.assignDepositAddress({ accountId, address })
    created.depositAddress = depositAddress

    const { subscriptionId } = await vaProvider.createSubscription({ accountId, address: depositAddress, chain: network, webhookUrl })
    created.subscriptionId = subscriptionId
    console.log(`PROVISION: deposit address ${depositAddress}, subscription ${subscriptionId}`)

    const now = Date.now()

    return {
      accountNo,
      depositAddress,
      vAccountId: accountId,
      kmsKeyId,
      subscriptionId,
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
  } catch (err) {
    await undoProvisioning(provider, created)
    throw err
  }
}
