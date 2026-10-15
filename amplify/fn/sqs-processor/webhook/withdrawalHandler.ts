import { updateItem, putItem } from '../../../utils/db'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ledger/ProviderName'
import { BroadcastUncertainError } from '../../../providers/ledger/provider'
import { notifyPaymentResult } from '../../../utils/websocket'
import { isNativeCurrency } from '../../../utils/currencies'
import { getMasterAccount } from '../../../utils/masterAccount'
import { findAccountForUser } from '../../../utils/custodialAccount'
import { accountKeyRef } from '../../../utils/signing'
import { settleOperation } from '../../../utils/operations'

const BALANCE_TABLE_NAME = 'v1AccountBalanceTable'

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

    // Token withdrawals (e.g. USDT_TRON) are signed and broadcast from the
    // master account, not the customer's own deposit address — the sweep
    // already moved those tokens there. The customer's own VA (accountId)
    // is still what gets debited in Tatum's ledger; only the on-chain
    // signer/source changes.
    let signerAddress = account.depositAddress
    let signerKey = accountKey
    let masterAccountId: string | undefined
    if (!isNativeCurrency(chain)) {
      const master = await getMasterAccount(merchantId, chain)
      if (!master) throw new Error(`No ${chain} master for merchant ${merchantId ?? '(none)'} — cannot process token withdrawal`)
      signerAddress = master.depositAddress
      signerKey = master.key
      masterAccountId = master.vAccountId
    }

    const provider = ProviderRegistry.getProvider(ProviderName.Tatum)
    const { withdrawalId, masterWithdrawalId, txId } = await provider.withdrawFunds({
      accountId: vAccountId,
      address: destinationAddress,
      amount: String(cryptoAmount),
      currency: chain,
      key: signerKey,
      senderAddress: signerAddress,
      masterAccountId,
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

    await settleOperation(userId, transactionId, { status: 'completed', txId })

    await notifyPaymentResult(transactionId, userId, {
      success: true,
      status: 'withdrawal_complete',
      paymentTransactionId: withdrawalId,
      txId,
    })

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
      // Still pending, never failed: the coins may already have left
      await settleOperation(userId, transactionId, { status: 'pending', stage: 'uncertain' })
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

    // Provably not sent, and refunded above
    await settleOperation(userId, transactionId, { status: 'failed' })

    await notifyPaymentResult(transactionId, userId, {
      success: false,
      status: 'withdrawal_failed',
    })

    return false
  }
}
