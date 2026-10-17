import { putItem, queryRecord } from '../../../utils/db'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ledger/ProviderName'
import type { AccountProvider } from '../../../providers/ledger/provider'
import { isTronAccountActive } from '../../../providers/ledger/tatum/chains/tron'
import { maxActivationSun } from '../../../providers/energy/ensureResources'
import type { Activation } from '../../../providers/energy/EnergyProvider'
import { getFeeAccountId, getMasterAccount, type MasterAccount } from '../../../utils/masterAccount'
import { findAccountByAddress } from '../../../utils/custodialAccount'
import { isNativeCurrency } from '../../../utils/currencies'
import { accountKeyRef, type KeyRef } from '../../../utils/signing'
import { applyBalanceChangeOnce } from '../../../utils/balance'
import { fetchCryptoPrice } from '../../../utils/exchangeRate'

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

// What activating an address costs in a dollar token, rounded up to its 6
// decimals. In integers, so float error can't add a unit (1.5 TRX at 0.3002 is 0.4503, not 0.450301)
const activationFee = (sun: number, trxPrice: number) => Math.ceil(sun * Math.round(trxPrice * 1e8) / 1e8) / 1e6

// Run before a token sweep is claimed (docs/energy-rental-plan.md D6, D7). An
// address never activated is activated by its sweep, at the customer's cost and
// the live TRX price: answers that price. Until their balance covers the dearest
// activation, the coins wait there for a later deposit's sweep: answers 'wait'.
// null when the address is active.
async function activationPrice(account: Record<string, any>): Promise<number | 'wait' | null> {
  const { vAccountId, chain, depositAddress } = account
  if (await isTronAccountActive(depositAddress)) return null
  const [trxPrice, balance] = await Promise.all([
    fetchCryptoPrice('TRON', 'USDT'),
    queryRecord('v1AccountBalanceTable', 'id = :id', { ':id': vAccountId }, true),
  ])
  if (!balance.success) throw new Error(`Failed to read the balance of ${vAccountId}`)
  const available = Number(balance.res?.[0]?.availableBalance ?? 0)
  const fee = activationFee(maxActivationSun(), trxPrice)
  if (available >= fee) return trxPrice
  console.log(`SWEEP_WAITING: ${depositAddress} was never activated, and the balance of ${vAccountId} (${available} ${chain}) is below the ${fee} activating it may cost`)
  return 'wait'
}

// The customer pays for their address's activation (D6): a FEE row and the fee
// off their balance, and the same amount moved from their VA to the merchant's
// fee VA, so master VA = Σ customer VAs + fee VA still holds. Keyed by the
// address, which activates once, so a second report (two sweeps racing) charges
// nothing more. What fails is logged to be settled by hand; it never throws.
async function chargeActivation(provider: AccountProvider, account: Record<string, any>, { provider: renter, sun }: Activation, trxPrice: number) {
  const { vAccountId, chain, depositAddress, merchantId } = account
  const fee = activationFee(sun, trxPrice)
  const unsettled = (what: string, err: unknown = '') =>
    console.error(`CRITICAL FEE_UNSETTLED: ${what}. Activation of ${depositAddress} by ${renter}: ${sun} sun at ${trxPrice}, fee=${fee} ${chain}, vAccountId=${vAccountId}`, err)
  try {
    const recorded = await applyBalanceChangeOnce({ account, direction: 'DEBIT', amount: fee, currency: chain, txId: `activation-${depositAddress}`, from: depositAddress, type: 'FEE' })
    if (recorded === 'duplicate') return
    if (recorded === 'failed') return unsettled('the FEE row or the balance was not written')
    const feeVaId = await getFeeAccountId(merchantId, chain)
    if (!feeVaId) return unsettled(`merchant ${merchantId ?? '(none)'} has no ${chain} fee VA`)
    const { reference } = await provider.transferFunds({ senderAccountId: vAccountId, recipientAccountId: feeVaId, amount: String(fee) })
    console.log(`ACTIVATION_CHARGED: ${fee} ${chain} from VA ${vAccountId} to fee VA ${feeVaId} for ${depositAddress} (${renter}, ${sun} sun at ${trxPrice}), reference=${reference}`)
  } catch (err) {
    unsettled('the fee was not moved to the fee VA', err)
  }
}

// Sends the address's whole token balance, so coins a waiting or failed sweep
// left behind go with this one. With `trxPrice`, the sweep may activate the
// address, and the customer is charged at that price once it is paid for
async function sweepToken(provider: AccountProvider, account: Record<string, any>, master: MasterAccount, key: KeyRef, depositTxId: string, trxPrice: number | null) {
  const { chain, depositAddress } = account
  const balance = await provider.getOnChainBalance({ chain, address: depositAddress })
  if (!(balance > 0)) {
    console.log(`SWEEP_SKIPPED: ${depositAddress} holds no ${chain} (depositTx=${depositTxId})`)
    return
  }
  const { txId } = await provider.sendOnChain({
    chain,
    senderAddress: depositAddress,
    recipientAddress: master.depositAddress,
    amount: String(balance),
    key,
    onActivated: trxPrice == null ? undefined : (activation) => chargeActivation(provider, account, activation, trxPrice),
  })
  console.log(`SWEEP_SUCCESS: depositTx=${depositTxId}, sweepTx=${txId}, amount=${balance} ${chain}`)
}

/**
 * Consolidates a customer's deposit address to that currency's master wallet,
 * sending its whole balance, a token's or a native coin's.
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

  let trxPrice: number | null = null
  if (!native) {
    try {
      const price = await activationPrice(account)
      if (price === 'wait') return true
      trxPrice = price
    } catch (err) {
      console.error(`SWEEP_ERROR: could not tell whether ${senderAddress} must be activated, or what that costs ${vAccountId}; sweep ${txId} not claimed`, err)
      return false
    }
  }

  console.log(`--- Processing Sweep [${txId}] for Account [${vAccountId}] ---`)
  console.log(`Sweeping the ${currency} balance from ${senderAddress} to ${masterAddress}`)

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
    if (native) await sweepNative(provider, account, master, key, txId)
    else await sweepToken(provider, account, master, key, txId, trxPrice)
    return true
  } catch (err) {
    console.error(`SWEEP_ERROR: Failed to sweep depositTx=${txId} for ${vAccountId}.`, err)
    return false
  }
}
