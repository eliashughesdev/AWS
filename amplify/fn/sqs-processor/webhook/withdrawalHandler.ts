import { updateItem } from '../../../utils/db'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ledger/ProviderName'
import { notifyPaymentResult } from '../../../utils/websocket'

const BALANCE_TABLE_NAME = 'v1AccountBalanceTable'

export const handleWithdrawal = async (message: any): Promise<boolean> => {
  const { transactionId, userId, vAccountId, chain, cryptoAmount, destinationAddress, signatureId, senderAddress } = message

  if (!vAccountId || !chain || !cryptoAmount || !destinationAddress || !signatureId) {
    console.error('VALIDATION_ERROR: Missing required fields for withdrawal processing', message)
    return false
  }

  console.log(`--- Processing Withdrawal [${transactionId}] for Account [${vAccountId}] ---`)
  console.log(`Sending ${cryptoAmount} ${chain} to ${destinationAddress}`)

  try {
    const provider = ProviderRegistry.getProvider(ProviderName.Tatum)
    const { withdrawalId } = await provider.withdrawFunds({
      accountId: vAccountId,
      address: destinationAddress,
      amount: String(cryptoAmount),
      currency: chain,
      signatureId,
      senderAddress,
    })

    console.log(`WITHDRAWAL_SUCCESS: withdrawalId=${withdrawalId}, txId=${transactionId}`)

    await notifyPaymentResult(transactionId, userId, {
      success: true,
      status: 'withdrawal_complete',
      paymentTransactionId: withdrawalId,
    })

    return true
  } catch (err) {
    // The balance was already deducted in the route handler before queuing.
    // Since the payout failed, we credit it back to restore the account to its original state.
    console.error(`WITHDRAWAL_ERROR: Payout failed for txId=${transactionId}. Rolling back balance.`, err)

    const rollback = await updateItem({
      tableName: BALANCE_TABLE_NAME,
      key: { id: vAccountId },
      updateExpression: 'SET #balance = #balance + :amount, #lastUpdated = :now',
      attributeNames: {
        '#balance': 'balance',
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

    await notifyPaymentResult(transactionId, userId, {
      success: false,
      status: 'withdrawal_failed',
    })

    return false
  }
}
