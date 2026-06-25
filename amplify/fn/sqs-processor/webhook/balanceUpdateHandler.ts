import { getRecord, updateItem, putItem, queryItemFromIndex } from '../../../utils/db'

interface IncomingBlockchainTransactionRequest {
  address: string;             // the watched account this event is about
  counterAddress?: string;     // the other party (TRON sends a single string)
  counterAddresses?: string[]; // the other party (Solana sends an array)
  amount: string;              // signed from `address`'s view: positive = received, negative = sent
  currency?: string;
  asset?: string;
  chain?: string;
  type?: string;
  subscriptionType: string;
  subscriptionId?: string;
  txId?: string;
  blockNumber?: number;
  timestamp?: number;
  index?: number;
  queue?: string;
}

const BALANCE_TABLE_NAME = 'v1AccountBalanceTable'

type Direction = 'CREDIT' | 'DEBIT'

async function findAccountByAddress(address: string) {
  const lookup = await queryItemFromIndex({
    tableName: 'v2CustomerTable',
    indexName: 'v1v2CustomerTableByDepositAddress',
    keyConditionExpression: 'depositAddress = :addr',
    attributeNames: undefined,
    attributeValues: { ':addr': address },
  })
  if (!lookup.success || !lookup.res?.length) return null
  return lookup.res[0]
}

// Applies one side of a transfer to an account. Idempotent per (account, txId)
// via the transaction-log claim. Returns false only on an unexpected failure so
// the SQS message is retried.
async function applyBalanceChange(params: {
  account: any
  direction: Direction
  amount: number
  currency: string
  txId: string
  from?: string
  to?: string
  blockNumber?: number
  index?: number
}): Promise<boolean> {
  const { account, direction, amount, currency, txId } = params
  const isNonCustodial = account.walletType === 'non-custodial'
  const balanceKey: string = isNonCustodial ? account.accountNo : account.vAccountId
  const signedDelta = direction === 'CREDIT' ? amount : -amount
  const txType = direction === 'CREDIT' ? 'DEPOSIT' : 'WITHDRAWAL'

  console.log(`${direction} ${amount.toFixed(6)} ${currency} on ${balanceKey} (${isNonCustodial ? 'non-custodial' : 'custodial'}) tx ${txId}`)

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
      return true
    }
    console.error(`LOG_ERROR: Failed to claim tx ${txId} for ${balanceKey}:`, claim.error)
    return false
  }

  const current = await getRecord(BALANCE_TABLE_NAME, balanceKey)
  if (!current.success || !current.res) {
    console.error(`DB_ERROR: Balance record not found for ${balanceKey}.`)
    return false
  }

  const newBalance = parseFloat(current.res.balance || '0') + signedDelta
  const newAvailable = parseFloat(current.res.availableBalance || '0') + signedDelta

  console.log(`BALANCE_CALC: ${balanceKey} ${direction === 'CREDIT' ? '+' : '-'}${amount.toFixed(6)} = ${newBalance.toFixed(6)}`)

  const update = await updateItem({
    tableName: BALANCE_TABLE_NAME,
    key: { id: balanceKey },
    updateExpression: 'SET #balance = :newBalance, #availableBalance = :newAvailable, #lastUpdated = :now',
    attributeNames: {
      '#balance': 'balance',
      '#availableBalance': 'availableBalance',
      '#lastUpdated': 'lastUpdated',
    },
    attributeValues: {
      ':newBalance': newBalance,
      ':newAvailable': newAvailable,
      ':now': new Date().toISOString(),
    },
  })

  if (!update.success) {
    console.error(`DB_ERROR: Failed to update balance for ${balanceKey}, tx ${txId}:`, update.error)
    return false
  }

  console.log(`TX_SUCCESS: ${balanceKey} updated to ${newBalance.toFixed(6)} ${currency}. TX: ${txId}`)
  return true
}

// Collects the counterparty address(es) across chain shapes: TRON sends a single
// `counterAddress` string, Solana sends a `counterAddresses` array.
function collectCounterparties(body: IncomingBlockchainTransactionRequest): string[] {
  const list: string[] = []
  if (body.counterAddress) list.push(body.counterAddress)
  if (Array.isArray(body.counterAddresses)) list.push(...body.counterAddresses)
  return Array.from(new Set(list))
}

export const handleBalanceUpdate = async (message: any): Promise<boolean> => {
  const body: IncomingBlockchainTransactionRequest = message

  // A single on-chain transfer can emit several events (e.g. a `fee` event).
  // Only the native transfer moves balances.
  if (body.type && body.type !== 'native') {
    console.log(`SKIP_NON_NATIVE: Ignoring '${body.type}' event for tx ${body.txId ?? 'unknown'}`)
    return true
  }

  if (!body.address || body.amount == null) {
    console.error('VALIDATION_ERROR: Missing required fields (address, amount) for balance update')
    return false
  }

  // Tatum reports the amount signed from the watched address's perspective:
  // positive = funds received, negative = funds sent. Zero moves no balance.
  const rawAmount = parseFloat(body.amount)
  const currency = body.currency ?? body.asset ?? 'UNKNOWN'
  const txId = body.txId || 'unknown'

  if (!Number.isFinite(rawAmount) || rawAmount === 0) {
    console.log(`SKIP_ZERO_AMOUNT: Ignoring tx ${txId} with amount "${body.amount}"`)
    return true
  }

  const amount = Math.abs(rawAmount)
  const isOutgoing = rawAmount < 0

  const primary = await findAccountByAddress(body.address)
  const counterparties = collectCounterparties(body)
  const counterAccounts = (await Promise.all(counterparties.map(findAccountByAddress)))
    .filter((a): a is NonNullable<typeof a> => a != null)

  if (!primary && counterAccounts.length === 0) {
    console.error(`ACCOUNT_NOT_FOUND: Neither ${body.address} nor [${counterparties.join(', ') || 'n/a'}] maps to an account. tx ${txId}`)
    return false
  }

  console.log(`--- Processing TX [${txId}] amount ${rawAmount} ${currency} (address=${body.address}, counterparties=[${counterparties.join(', ') || 'n/a'}]) ---`)

  let ok = true

  if (isOutgoing) {
    // `address` sent funds. Debit it only when non-custodial — custodial sends are
    // already debited by their route handler (withdrawal pre-queue / transfer), so
    // debiting here would double-count. Solana emits this signed event per address.
    if (primary && primary.walletType === 'non-custodial') {
      ok = await applyBalanceChange({
        account: primary, direction: 'DEBIT', amount, currency, txId,
        from: body.address, to: counterparties[0], blockNumber: body.blockNumber, index: body.index,
      }) && ok
    }
  } else {
    // `address` received funds — credit it (custodial and non-custodial).
    if (primary) {
      ok = await applyBalanceChange({
        account: primary, direction: 'CREDIT', amount, currency, txId,
        from: counterparties[0], to: body.address, blockNumber: body.blockNumber, index: body.index,
      }) && ok
    }

    // TRON carries the sender as a counterparty in this same event; debit non-custodial
    // senders here. Idempotent if Solana already debited it via its own signed event.
    for (const acc of counterAccounts) {
      if (acc.walletType === 'non-custodial') {
        ok = await applyBalanceChange({
          account: acc, direction: 'DEBIT', amount, currency, txId,
          from: acc.depositAddress, to: body.address, blockNumber: body.blockNumber, index: body.index,
        }) && ok
      }
    }
  }

  return ok
}
