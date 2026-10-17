import { updateItem, putItem } from '../../../utils/db'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ledger/ProviderName'

const BALANCE_TABLE = 'v1AccountBalanceTable'
const TX_TABLE = 'v1TransactionLogsTable'
const CUSTOMER_TABLE = 'v2CustomerTable'

export const handleAccountBackfill = async (message: any): Promise<boolean> => {
  const { userId, accountNo, address, chain } = message
  console.log(`BACKFILL: start ${accountNo} (${chain} ${address})`)

  try {
    const provider = ProviderRegistry.getProvider(message.provider ?? ProviderName.Tatum)

    // 1. Seed the balance from the on-chain snapshot. Authoritative: it already
    //    nets every historical tx, so we never sum the history into it.
    const snapshot = await provider.getOnChainBalance({ chain, address })
    const seeded = await updateItem({
      tableName: BALANCE_TABLE,
      key: { id: accountNo },
      updateExpression: 'SET #balance = :b, #available = :b, #updated = :now',
      attributeNames: { '#balance': 'balance', '#available': 'availableBalance', '#updated': 'updated_at' },
      attributeValues: { ':b': snapshot, ':now': Date.now() },
    })
    if (!seeded.success) {
      console.error(`BACKFILL: failed to seed balance for ${accountNo}`)
      return false
    }
    console.log(`BACKFILL: seeded balance ${snapshot} for ${accountNo}`)

    // 2. Write history as display-only TX rows. Idempotent via attribute_not_exists,
    //    and these rows double as claims so a live webhook for the same tx won't
    //    re-apply it to the seeded balance.
    const history = await provider.getAddressHistory({ chain, address })
    let written = 0
    for (const tx of history) {
      const claim = await putItem(
        TX_TABLE,
        {
          id: accountNo,
          sk: `TX#${tx.txId}`,
          txId: tx.txId,
          type: tx.amount < 0 ? 'WITHDRAWAL' : 'DEPOSIT',
          amount: Math.abs(tx.amount),
          currency: tx.currency,
          from: tx.from,
          to: tx.to,
          blockNumber: tx.blockNumber,
          createdAt: new Date(tx.timestamp ?? Date.now()).toISOString(),
        },
        'attribute_not_exists(sk)'
      )
      if (claim.success) written++
      else if (claim.error?.name !== 'ConditionalCheckFailedException') {
        console.error(`BACKFILL: failed to write tx ${tx.txId}:`, claim.error)
        return false
      }
    }
    console.log(`BACKFILL: wrote ${written}/${history.length} tx rows for ${accountNo}`)

    // 3. Mark the account active.
    await updateItem({
      tableName: CUSTOMER_TABLE,
      key: { id: userId, sk: `ACCOUNT#${accountNo}` },
      updateExpression: 'SET #status = :active',
      attributeNames: { '#status': 'status' },
      attributeValues: { ':active': 'active' },
    })

    console.log(`BACKFILL: complete ${accountNo}`)
    return true
  } catch (e) {
    console.error(`BACKFILL: error for ${accountNo}:`, e)
    return false
  }
}
