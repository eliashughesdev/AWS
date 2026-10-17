import { putItem, updateItem } from './db'

const BALANCE_TABLE_NAME = 'v1AccountBalanceTable'

export type Direction = 'CREDIT' | 'DEBIT'

export interface BalanceChange {
  account: any
  direction: Direction
  amount: number
  currency: string
  txId: string
  from?: string
  to?: string
  blockNumber?: number
  index?: number
  type?: string
}

// Applies one side of a transfer to an account. Idempotent per (account, txId)
// via the transaction-log claim. Returns false only on an unexpected failure.
// The update is relative, so a concurrent writer's change isn't lost (B4).
export async function applyBalanceChange(params: BalanceChange): Promise<boolean> {
  return (await applyBalanceChangeOnce(params)) !== 'failed'
}

// The same, saying whether this call moved the balance: 'duplicate' when the
// txId was applied to the account before
export async function applyBalanceChangeOnce(params: BalanceChange): Promise<'applied' | 'duplicate' | 'failed'> {
  const { account, direction, amount, currency, txId } = params
  const balanceKey: string = account.vAccountId
  const signedDelta = direction === 'CREDIT' ? amount : -amount
  const txType = params.type ?? (direction === 'CREDIT' ? 'DEPOSIT' : 'WITHDRAWAL')

  console.log(`${direction} ${amount.toFixed(6)} ${currency} on ${balanceKey} tx ${txId}`)

  const claim = await putItem(
    'v1TransactionLogsTable',
    {
      id: balanceKey,
      sk: `TX#${txId}`,
      txId,
      type: txType,
      amount,
      currency,
      from: params.from,
      to: params.to,
      blockNumber: params.blockNumber,
      index: params.index,
      createdAt: new Date().toISOString(),
    },
    'attribute_not_exists(sk)'
  )

  if (!claim.success) {
    if (claim.error?.name === 'ConditionalCheckFailedException') {
      console.log(`DUPLICATE_TX: ${txId} already applied to ${balanceKey}. Skipping.`)
      return 'duplicate'
    }
    console.error(`LOG_ERROR: Failed to claim tx ${txId} for ${balanceKey}:`, claim.error)
    return 'failed'
  }

  // A missing balance record fails here too: the expression reads attributes it doesn't have
  const update = await updateItem({
    tableName: BALANCE_TABLE_NAME,
    key: { id: balanceKey },
    updateExpression: 'SET #balance = #balance + :delta, #availableBalance = #availableBalance + :delta, #lastUpdated = :now',
    attributeNames: {
      '#balance': 'balance',
      '#availableBalance': 'availableBalance',
      '#lastUpdated': 'lastUpdated',
    },
    attributeValues: {
      ':delta': signedDelta,
      ':now': new Date().toISOString(),
    },
    returnValues: 'UPDATED_NEW',
  })

  if (!update.success) {
    console.error(`DB_ERROR: Failed to update balance for ${balanceKey}, tx ${txId}:`, update.error)
    return 'failed'
  }

  console.log(`TX_SUCCESS: ${balanceKey} updated to ${update.res?.Attributes?.balance?.N} ${currency}. TX: ${txId}`)
  return 'applied'
}
