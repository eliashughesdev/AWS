import { updateItem, putItem } from '../../../utils/db'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ledger/ProviderName'
import { BroadcastUncertainError, type AccountProvider } from '../../../providers/ledger/provider'
import { notifyPaymentResult } from '../../../utils/websocket'
import { isNativeCurrency } from '../../../utils/currencies'
import { getMasterAccount, type MasterAccount } from '../../../utils/masterAccount'
import { findAccountForUser } from '../../../utils/custodialAccount'
import { accountKeyRef } from '../../../utils/signing'
import { applyBalanceChange } from '../../../utils/balance'

const BALANCE_TABLE_NAME = 'v1AccountBalanceTable'

// How long a master-signed native withdrawal waits for its receipt. TRON has one
// within a block or two (3 s each), Solana once the transaction is confirmed
const FEE_POLL_INTERVAL_MS = 3_000
const FEE_POLL_TIMEOUT_MS = 90_000

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// The fee the chain charged for a transaction, or null when no receipt came in time
async function readFee(provider: AccountProvider, chain: string, txId: string): Promise<number | null> {
  const deadline = Date.now() + FEE_POLL_TIMEOUT_MS
  for (;;) {
    try {
      const fee = await provider.getTransactionFee({ chain, txId })
      if (fee != null) return fee
    } catch (err) {
      console.warn(`FEE_READ_RETRY: could not read the receipt of ${txId}`, err)
    }
    if (Date.now() + FEE_POLL_INTERVAL_MS > deadline) return null
    await sleep(FEE_POLL_INTERVAL_MS)
  }
}

// The master paid a native withdrawal's fee, and no webhook reports it (masters
// have no subscription). The customer is charged what the receipt says: a FEE
// row like the one the fee webhook writes, and the same amount off their VA and
// the master's VA. Nothing retries (B5), so what fails is logged to be settled by hand.
async function settleMasterFee(provider: AccountProvider, account: Record<string, any>, master: MasterAccount, txId: string, destinationAddress: string) {
  const { vAccountId, chain } = account
  const unsettled = (what: string, fee: number | null, err: unknown = '') =>
    console.error(`CRITICAL FEE_UNSETTLED: ${what}. txId=${txId}, vAccountId=${vAccountId}, master=${master.vAccountId} (${master.depositAddress}), fee=${fee ?? 'unknown'} ${chain}`, err)

  const fee = await readFee(provider, chain, txId)
  if (fee == null) return unsettled(`no receipt within ${FEE_POLL_TIMEOUT_MS / 1000} s`, fee)

  const recorded = await applyBalanceChange({ account, direction: 'DEBIT', amount: fee, currency: chain, txId, from: master.depositAddress, type: 'FEE' })
  if (!recorded) unsettled('the FEE row or the balance was not written', fee)

  if (fee === 0) return
  for (const accountId of [vAccountId, master.vAccountId]) {
    try {
      const withdrawalId = await provider.debitFee({ accountId, address: destinationAddress, amount: fee, currency: chain, txId })
      console.log(`FEE_SETTLED: ${fee} ${chain} off VA ${accountId}, withdrawalId=${withdrawalId}, txId=${txId}`)
    } catch (err) {
      unsettled(`VA ${accountId} was not debited`, fee, err)
    }
  }
}

export const handleWithdrawal = async (message: any): Promise<boolean> => {
  const { transactionId, userId, vAccountId, cryptoAmount, destinationAddress } = message

  if (!userId || !vAccountId || !cryptoAmount || !destinationAddress) {
    console.error('VALIDATION_ERROR: Missing required fields for withdrawal processing', message)
    return false
  }

  console.log(`--- Processing Withdrawal [${transactionId}] for Account [${vAccountId}] ---`)

  // The key, address, merchant and chain come from the stored account, never
  // from the message
  let account: Record<string, any> | null = null

  try {
    account = await findAccountForUser(userId, vAccountId)
    // Nothing was debited for an account that doesn't exist, so nothing is rolled back
    const accountKey = account && accountKeyRef(account)
    if (!account || !accountKey || !account.chain) {
      console.error(`VALIDATION_ERROR: No custodial account ${vAccountId} for user ${userId}; withdrawal ${transactionId} not processed`)
      return false
    }
    const { chain, merchantId } = account
    console.log(`Sending ${cryptoAmount} ${chain} to ${destinationAddress}`)

    // When the merchant has a master for the currency, the withdrawal is signed
    // and sent from it, not the customer's own deposit address: the sweep already
    // moved the coins there. Both the customer's VA and the master's are debited.
    // A token always has one; a native coin with none is still sent from the
    // customer's own address.
    const master = await getMasterAccount(merchantId, chain)
    if (!master && !isNativeCurrency(chain)) throw new Error(`No ${chain} master for merchant ${merchantId ?? '(none)'} — cannot process token withdrawal`)
    const signerAddress = master?.depositAddress ?? account.depositAddress
    const signerKey = master?.key ?? accountKey

    const provider = ProviderRegistry.getProvider(ProviderName.Tatum)
    const { withdrawalId, masterWithdrawalId, txId } = await provider.withdrawFunds({
      accountId: vAccountId,
      address: destinationAddress,
      amount: String(cryptoAmount),
      currency: chain,
      key: signerKey,
      senderAddress: signerAddress,
      masterAccountId: master?.vAccountId,
    })

    console.log(`WITHDRAWAL_SUCCESS: withdrawalId=${withdrawalId}, masterWithdrawalId=${masterWithdrawalId ?? 'n/a'}, txId=${txId}, reference=${transactionId}`)

    const createdAt = new Date().toISOString()
    await putItem('v1TransactionLogsTable', {
      id: vAccountId,
      sk: `TX#${createdAt}#${transactionId}`,
      txId,
      reference: transactionId,
      withdrawalId,
      masterWithdrawalId,
      type: 'WITHDRAWAL',
      amount: cryptoAmount,
      currency: chain,
      from: signerAddress,
      to: destinationAddress,
      createdAt,
    })

    await notifyPaymentResult(transactionId, userId, {
      success: true,
      status: 'withdrawal_complete',
      paymentTransactionId: withdrawalId,
      txId,
    })

    // A token's gas is rented TRX, so only a native coin has a fee to settle. The
    // coins have left, so a failure here must never reach the rollback below
    if (master && isNativeCurrency(chain)) {
      await settleMasterFee(provider, account, master, txId, destinationAddress)
        .catch(err => console.error(`CRITICAL FEE_UNSETTLED: settling the fee of ${txId} for ${vAccountId} failed`, err))
    }

    return true
  } catch (err) {
    const chain = account?.chain
    const senderAddress = account?.depositAddress

    // The coins may have left — refunding here could pay the customer twice
    if (err instanceof BroadcastUncertainError) {
      console.error(`CRITICAL: Withdrawal ${transactionId} broadcast outcome unknown — balance NOT rolled back. Resolve manually (withdrawalId=${err.withdrawalId}, masterWithdrawalId=${err.masterWithdrawalId ?? 'n/a'}).`, err)
      const createdAt = new Date().toISOString()
      await putItem('v1TransactionLogsTable', {
        id: vAccountId,
        sk: `TX#${createdAt}#${transactionId}`,
        reference: transactionId,
        withdrawalId: err.withdrawalId,
        masterWithdrawalId: err.masterWithdrawalId,
        type: 'WITHDRAWAL_UNCERTAIN',
        amount: cryptoAmount,
        currency: chain,
        from: senderAddress,
        to: destinationAddress,
        createdAt,
      })
      return false
    }

    // The balance was already deducted in the route handler before queuing.
    // Since the payout failed, we credit it back to restore the account to its original state.
    console.error(`WITHDRAWAL_ERROR: Payout failed for txId=${transactionId}. Rolling back balance.`, err)

    const rollback = await updateItem({
      tableName: BALANCE_TABLE_NAME,
      key: { id: vAccountId },
      updateExpression: 'SET #balance = #balance + :amount, #availableBalance = #availableBalance + :amount, #lastUpdated = :now',
      attributeNames: {
        '#balance': 'balance',
        '#availableBalance': 'availableBalance',
        '#lastUpdated': 'lastUpdated',
      },
      attributeValues: {
        ':amount': cryptoAmount,
        ':now': new Date().toISOString(),
      },
    })

    if (!rollback.success) {
      console.error(`CRITICAL: Balance rollback FAILED for vAccountId=${vAccountId}, amount=${cryptoAmount} ${chain}. Manual intervention required.`)
    } else {
      console.log(`ROLLBACK_SUCCESS: Balance restored for vAccountId=${vAccountId}`)
    }

    const createdAt = new Date().toISOString()
    await putItem('v1TransactionLogsTable', {
      id: vAccountId,
      sk: `TX#${createdAt}#${transactionId}`,
      reference: transactionId,
      type: 'WITHDRAWAL_FAILED',
      amount: cryptoAmount,
      currency: chain,
      from: senderAddress,
      to: destinationAddress,
      createdAt,
    })

    await notifyPaymentResult(transactionId, userId, {
      success: false,
      status: 'withdrawal_failed',
    })

    return false
  }
}
