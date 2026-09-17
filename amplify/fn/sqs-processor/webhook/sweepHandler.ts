import { putItem } from '../../../utils/db'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ledger/ProviderName'

/**
 * Consolidates a customer's just-received token deposit to the master
 * account. No ledger movement — the customer's balance was already credited
 * in balanceUpdateHandler.ts and stays as-is; this only moves the on-chain
 * tokens sitting at their deposit address.
 *
 * Claimed before the on-chain move (not after), so a redelivered message
 * arriving while a slow rental/broadcast is still in flight doesn't
 * double-sweep. Trade-off: a failure after this claim (e.g. broadcast times
 * out) leaves that sweep permanently un-retried — a known gap, same shape as
 * this codebase's other documented deferred issues (see
 * docs/tatum-integration-model.md's "known gaps").
 */
export const handleSweep = async (message: any): Promise<boolean> => {
  const { vAccountId, senderAddress, kmsKeyId, amount, currency, txId } = message

  if (!vAccountId || !senderAddress || !kmsKeyId || !amount || !currency || !txId) {
    console.error('VALIDATION_ERROR: Missing required fields for sweep processing', message)
    return false
  }

  const masterAddress = process.env.MASTER_ACCOUNT_ADDRESS
  if (!masterAddress) {
    console.error('CONFIG_ERROR: MASTER_ACCOUNT_ADDRESS is not set — cannot sweep')
    return false
  }

  console.log(`--- Processing Sweep [${txId}] for Account [${vAccountId}] ---`)
  console.log(`Sweeping ${amount} ${currency} from ${senderAddress} to ${masterAddress}`)

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
    const provider = ProviderRegistry.getProvider(ProviderName.Tatum)
    const { txId: sweepTxId } = await provider.sendOnChain({
      chain: currency,
      senderAddress,
      recipientAddress: masterAddress,
      amount: String(amount),
      kmsKeyId,
    })

    console.log(`SWEEP_SUCCESS: depositTx=${txId}, sweepTx=${sweepTxId}`)
    return true
  } catch (err) {
    console.error(`SWEEP_ERROR: Failed to sweep depositTx=${txId} for ${vAccountId}.`, err)
    return false
  }
}
