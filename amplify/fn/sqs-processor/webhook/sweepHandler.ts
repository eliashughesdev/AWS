import { putItem } from '../../../utils/db'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ledger/ProviderName'
import type { AccountProvider } from '../../../providers/ledger/provider'
import { getMasterAccount, type MasterAccount } from '../../../utils/masterAccount'
import { findAccountByAddress } from '../../../utils/custodialAccount'
import { isNativeCurrency } from '../../../utils/currencies'
import { accountKeyRef, type KeyRef } from '../../../utils/signing'

// A native sweep pays only its bandwidth fee, so the master must already be
// active (TRON) or hold the rent-exempt minimum (SOL). A person does both
async function masterCanReceive(provider: AccountProvider, currency: string, master: MasterAccount): Promise<boolean> {
  try {
    if (await provider.canReceiveSweep({ chain: currency, address: master.depositAddress })) return true
    console.error(`CONFIG_ERROR: ${currency} master ${master.depositAddress} (${master.vAccountId}) is not activated or funded — cannot sweep`)
  } catch (err) {
    console.error(`SWEEP_ERROR: could not check that ${currency} master ${master.depositAddress} can receive`, err)
  }
  return false
}

// Sends the address's whole balance, not the deposit's amount, so coins a failed
// sweep left behind (nothing retries, B5) go with this one. The customer pays the
// fee: the fee webhook writes their FEE row, and it comes off their VA here.
// Tatum credits the master VA with what arrives by itself.
async function sweepNative(provider: AccountProvider, account: Record<string, any>, master: MasterAccount, key: KeyRef, depositTxId: string) {
  const { vAccountId, chain, depositAddress } = account
  const swept = await provider.sweepAll({ chain, senderAddress: depositAddress, recipientAddress: master.depositAddress, key })
  if (!swept) {
    console.log(`SWEEP_SKIPPED: ${depositAddress} holds no more than a sweep's fee (depositTx=${depositTxId})`)
    return
  }
  console.log(`SWEEP_SUCCESS: depositTx=${depositTxId}, sweepTx=${swept.txId}, amount=${swept.amount}, fee=${swept.fee} ${chain}`)

  if (swept.fee === 0) return
  try {
    const withdrawalId = await provider.debitFee({ accountId: vAccountId, address: master.depositAddress, amount: swept.fee, currency: chain, txId: swept.txId })
    console.log(`FEE_SETTLED: ${swept.fee} ${chain} off VA ${vAccountId}, withdrawalId=${withdrawalId}, txId=${swept.txId}`)
  } catch (err) {
    console.error(`CRITICAL FEE_UNSETTLED: VA ${vAccountId} was not debited the sweep's fee. txId=${swept.txId}, fee=${swept.fee} ${chain}`, err)
  }
}

/**
 * Consolidates a customer's just-received deposit to that currency's master
 * wallet: a token's deposited amount, or a native coin's whole balance.
 *
 * Claimed before the on-chain move (not after), so a redelivered message
 * arriving while a slow rental/broadcast is still in flight doesn't
 * double-sweep. Trade-off: a failure after this claim (e.g. broadcast times
 * out) leaves that sweep permanently un-retried — a known gap, same shape as
 * this codebase's other documented deferred issues (see
 * docs/tatum-integration-model.md's "known gaps").
 */
export const handleSweep = async (message: any): Promise<boolean> => {
  const { vAccountId, senderAddress, amount, txId } = message

  if (!vAccountId || !senderAddress || !amount || !txId) {
    console.error('VALIDATION_ERROR: Missing required fields for sweep processing', message)
    return false
  }

  // The key, merchant and currency come from the stored account that owns the
  // address, never from the message. A master is never one, so it is never swept
  const account = await findAccountByAddress(senderAddress)
  const key = account && accountKeyRef(account)
  if (!account || !key || !account.chain || account.vAccountId !== vAccountId) {
    console.error(`VALIDATION_ERROR: No custodial account ${vAccountId} at ${senderAddress}; sweep ${txId} not processed`)
    return false
  }
  const { merchantId, chain: currency } = account

  const master = await getMasterAccount(merchantId, currency)
  if (!master) {
    console.error(`CONFIG_ERROR: No ${currency} master for merchant ${merchantId ?? '(none)'} — cannot sweep`)
    return false
  }
  const masterAddress = master.depositAddress
  const provider = ProviderRegistry.getProvider(ProviderName.Tatum)
  const native = isNativeCurrency(currency)

  if (native && !(await masterCanReceive(provider, currency, master))) return false

  console.log(`--- Processing Sweep [${txId}] for Account [${vAccountId}] ---`)
  console.log(`Sweeping ${native ? 'the balance' : amount} ${currency} from ${senderAddress} to ${masterAddress}`)

  const claim = await putItem(
    'v1TransactionLogsTable',
    {
      id: vAccountId,
      sk: `SWEEP#${txId}`,
      txId,
      type: 'SWEEP',
      amount,
      currency,
      from: senderAddress,
      to: masterAddress,
      createdAt: new Date().toISOString(),
    },
    'attribute_not_exists(sk)'
  )

  if (!claim.success) {
    if (claim.error?.name === 'ConditionalCheckFailedException') {
      console.log(`DUPLICATE_SWEEP: ${txId} already swept for ${vAccountId}. Skipping.`)
      return true
    }
    console.error(`LOG_ERROR: Failed to claim sweep ${txId} for ${vAccountId}:`, claim.error)
    return false
  }

  try {
    if (native) {
      await sweepNative(provider, account, master, key, txId)
      return true
    }

    const { txId: sweepTxId } = await provider.sendOnChain({
      chain: currency,
      senderAddress,
      recipientAddress: masterAddress,
      amount: String(amount),
      key,
    })

    console.log(`SWEEP_SUCCESS: depositTx=${txId}, sweepTx=${sweepTxId}`)
    return true
  } catch (err) {
    console.error(`SWEEP_ERROR: Failed to sweep depositTx=${txId} for ${vAccountId}.`, err)
    return false
  }
}
