import { putItem } from '../../../utils/db'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ledger/ProviderName'
import { getMasterAccount } from '../../../utils/masterAccount'
import { findAccountByAddress } from '../../../utils/custodialAccount'

/**
 * Consolidates a customer's just-received token deposit to that currency's
 * master wallet. 
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
  // address, never from the message
  const account = await findAccountByAddress(senderAddress)
  if (!account?.kmsKeyId || !account.chain || account.vAccountId !== vAccountId) {
    console.error(`VALIDATION_ERROR: No custodial account ${vAccountId} at ${senderAddress}; sweep ${txId} not processed`)
    return false
  }
  const { merchantId, kmsKeyId, chain: currency } = account

  const master = await getMasterAccount(merchantId, currency)
  if (!master) {
    console.error(`CONFIG_ERROR: No ${currency} master for merchant ${merchantId ?? '(none)'} — cannot sweep`)
    return false
  }
  const masterAddress = master.depositAddress

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
