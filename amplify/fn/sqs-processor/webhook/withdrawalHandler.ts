import { updateItem, putItem } from '../../../utils/db'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ledger/ProviderName'
import { notifyPaymentResult } from '../../../utils/websocket'
import { isNativeCurrency } from '../../../utils/currencies'
import { getMasterAccount } from '../../../utils/masterAccount'

const BALANCE_TABLE_NAME = 'v1AccountBalanceTable'

export const handleWithdrawal = async (message: any): Promise<boolean> => {
  const { transactionId, userId, vAccountId, chain, cryptoAmount, destinationAddress, kmsKeyId, senderAddress } = message

  if (!vAccountId || !chain || !cryptoAmount || !destinationAddress || !kmsKeyId) {
    console.error('VALIDATION_ERROR: Missing required fields for withdrawal processing', message)
    return false
  }

  console.log(`--- Processing Withdrawal [${transactionId}] for Account [${vAccountId}] ---`)
  console.log(`Sending ${cryptoAmount} ${chain} to ${destinationAddress}`)

  try {
    // Token withdrawals (e.g. USDT_TRON) are signed and broadcast from the
    // master account, not the customer's own deposit address — the sweep
    // already moved those tokens there. The customer's own VA (accountId)
    // is still what gets debited in Tatum's ledger; only the on-chain
    // signer/source changes.
    let signerAddress = senderAddress
    let signerKmsKeyId = kmsKeyId
    if (!isNativeCurrency(chain)) {
      const master = await getMasterAccount(chain)
      if (!master) throw new Error(`No master account configured for currency ${chain} — cannot process token withdrawal`)
      signerAddress = master.depositAddress
      signerKmsKeyId = master.kmsKeyId
    }

    const provider = ProviderRegistry.getProvider(ProviderName.Tatum)
    const { withdrawalId, txId } = await provider.withdrawFunds({
      accountId: vAccountId,
      address: destinationAddress,
      amount: String(cryptoAmount),
      currency: chain,
      kmsKeyId: signerKmsKeyId,
      senderAddress: signerAddress,
    })

    console.log(`WITHDRAWAL_SUCCESS: withdrawalId=${withdrawalId}, txId=${txId}, reference=${transactionId}`)

    const createdAt = new Date().toISOString()
    await putItem('v1TransactionLogsTable', {
      id: vAccountId,
      sk: `TX#${createdAt}#${transactionId}`,
      txId,
      reference: transactionId,
      withdrawalId,
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

    return true
  } catch (err) {
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
