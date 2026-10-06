import { ProviderRegistry } from './AccountProvider'
import { ProviderName } from '../providers/ledger/ProviderName'
import { networkFor } from './currencies'
import { queryItemFromIndex, queryRecord } from './db'
import { allocateAddress, createSeed } from './hdSigner'
import { canHoldCurrency } from './masterAccount'

// Queue handlers sign for the account these return. The key, address, merchant
// and chain come from the stored record, never from the message.

export const findAccountByAddress = async (address: string) => {
  const lookup = await queryItemFromIndex({
    tableName: 'v2CustomerTable',
    indexName: 'v1v2CustomerTableByDepositAddress',
    keyConditionExpression: 'depositAddress = :addr',
    attributeNames: undefined,
    attributeValues: { ':addr': address },
  })
  if (!lookup.success || !lookup.res?.length) return null
  return lookup.res[0]
}

// Throws when the table can't be read, so "no such account" stays distinct from "don't know"
export const findAccountForUser = async (userId: string, vAccountId: string) => {
  const lookup = await queryRecord('v2CustomerTable', 'id = :id AND begins_with(sk, :sk)', { ':id': userId, ':sk': 'ACCOUNT#' })
  if (!lookup.success || !lookup.res) throw new Error(`Failed to read accounts of user ${userId}`)
  return lookup.res.find(account => account.vAccountId === vAccountId) ?? null
}

export interface ProvisionedAccount {
  accountNo: string
  depositAddress: string
  vAccountId: string
  subscriptionId: string
  accountRecord: Record<string, any>
  balanceRecord: Record<string, any>
}

type Created = Partial<Pick<ProvisionedAccount, 'vAccountId' | 'depositAddress' | 'subscriptionId'>>

const undo = async (what: string, step: () => Promise<void>) => {
  try {
    await step()
    console.log(`PROVISION_UNDO: ${what}`)
  } catch (err) {
    console.error(`PROVISION_UNDO_FAILED: ${what}, left orphaned: ${(err as Error).message}`)
  }
}

// Newest first. Each step is best effort, so one failure doesn't strand the rest.
// The address itself needs no undoing: an unused index is only skipped.
const undoProvisioning = async (provider: ProviderName, { vAccountId, depositAddress, subscriptionId }: Created) => {
  const vaProvider = ProviderRegistry.getProvider(provider)
  if (subscriptionId) await undo(`cancel subscription ${subscriptionId}`, () => vaProvider.cancelSubscription(subscriptionId))
  if (vAccountId && depositAddress) await undo(`remove address ${depositAddress} from virtual account ${vAccountId}`, () => vaProvider.removeDepositAddress({ accountId: vAccountId, address: depositAddress }))
  if (vAccountId) await undo(`deactivate virtual account ${vAccountId}`, () => vaProvider.deactivateVaAccount(vAccountId))
}

/**
 * For a caller whose own write failed after provisioning. A write DynamoDB
 * rejected was never applied, so the account's resources are removed. After a
 * timeout or a 5xx it may have been applied, so they are only reported.
 */
export const discardProvisionedAccount = async (provider: ProviderName, account: ProvisionedAccount, writeError: any) => {
  if (writeError?.$fault === 'client') return undoProvisioning(provider, account)
  console.error(`PROVISION_UNDO_SKIPPED: write outcome unknown for ${account.accountNo}; virtual account ${account.vAccountId} and subscription ${account.subscriptionId} may be orphaned`)
}

/**
 * Creates the external half of a custodial account — Tatum virtual account,
 * the next address under its merchant's seed, and a webhook subscription for
 * it — and returns the records to persist. It deliberately does not write anything, and never touches
 * USERPROFILE: callers put the records in their own transaction so account
 * creation stays atomic with whatever else they are writing. A caller whose
 * write then fails must call discardProvisionedAccount.
 *
 * Throws on an unsupported `chain`, on a token whose merchant has no master
 * for it, or on any provider failure, after undoing what it had created,
 * leaving nothing in the database.
 */
export const provisionCustodialAccount = async ({ userId, chain, provider, accountingCurrency, merchantId }: {
  userId: string
  chain: string
  provider: ProviderName
  accountingCurrency: string
  merchantId: string
}): Promise<ProvisionedAccount> => {
  // `chain` is a Tatum ledger currency (TRON, SOL, USDT_TRON); the key and the
  // subscription need the network it settles on.
  const network = networkFor(chain)
  if (!network) throw new Error(`Unsupported ledger currency: ${chain}`)

  // Callers check this first to answer with 100050; this stops any that doesn't
  if (!(await canHoldCurrency(merchantId, chain))) throw new Error(`Merchant ${merchantId} has no ${chain} master`)

  const accountNo = provider + crypto.randomUUID().replaceAll('-', '')
  const webhookUrl = process.env.TATUM_WEBHOOK_URL!

  console.log(`PROVISION: ${chain} on ${network} for user ${userId} as ${accountNo}`)

  // A merchant's first account on a network creates its seed; after that this
  // changes nothing. Before the Tatum account, so a failure here leaves nothing.
  await createSeed(merchantId, network)

  const vaProvider = ProviderRegistry.getProvider(provider)
  const created: Created = {}

  try {
    // The virtual account comes first: it needs no address, so a request
    // Tatum rejects fails here with nothing to undo.
    const { accountId } = await vaProvider.createVaAccount({ userId, currency: chain, accountingCurrency })
    created.vAccountId = accountId
    console.log(`PROVISION: virtual account ${accountId}`)

    const { derivationIndex, address } = await allocateAddress(merchantId, network)
    console.log(`PROVISION: index ${derivationIndex} under ${merchantId}'s ${network} seed, address ${address}`)

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
      subscriptionId,
      accountRecord: {
        id: userId,
        sk: `ACCOUNT#${accountNo}`,
        currency: accountingCurrency,
        provider,
        accountNo,
        chain,
        keyModel: 'hd',
        derivationIndex,
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
