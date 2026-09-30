import { getRecord, updateItem, putItem, queryItemFromIndex } from '../../../utils/db'
import { isNativeCurrency } from '../../../utils/currencies'
import { sendToQueue } from '../../../utils/sqs'

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
  type?: string
}): Promise<boolean> {
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

// Credits a known custodial account directly by vAccountId — used when the caller
// already knows which balance record to credit (e.g. a card deposit) and doesn't have
// an on-chain address to look up. Idempotent per (account, txId) via the same
// transaction-log claim as applyBalanceChange.
export async function creditAccountByVAccountId(params: {
  vAccountId: string
  amount: number | string
  currency: string
  txId: string
}): Promise<boolean> {
  const amount = typeof params.amount === 'string' ? parseFloat(params.amount) : params.amount

  if (!Number.isFinite(amount) || amount <= 0) {
    console.error(`VALIDATION_ERROR: invalid amount "${params.amount}" for vAccountId ${params.vAccountId}`)
    return false
  }

  return applyBalanceChange({
    account: { vAccountId: params.vAccountId },
    direction: 'CREDIT',
    amount,
    currency: params.currency,
    txId: params.txId,
  })
}

// Collects the counterparty address(es) across chain shapes: TRON sends a single
// `counterAddress` string, Solana sends a `counterAddresses` array.
function collectCounterparties(body: IncomingBlockchainTransactionRequest): string[] {
  const list: string[] = []
  if (body.counterAddress) list.push(body.counterAddress)
  if (Array.isArray(body.counterAddresses)) list.push(...body.counterAddresses)
  return Array.from(new Set(list))
}

// Chains disagree on which field names the fee payer: TRON's `fee` event has no
// `address` at all (payer only in `counterAddress`); Solana's has `address` as the
// payer and no `counterAddress`. An asset with no entry here is left unhandled on
// purpose — safer to skip than to guess at an unverified shape.
const FEE_PAYER_RESOLVERS: Record<string, (body: IncomingBlockchainTransactionRequest) => string | undefined> = {
  TRON: (body) => body.counterAddress,
  SOL: (body) => body.address,
}

async function enqueueSweep(params: {
  vAccountId: string
  merchantId?: string
  senderAddress: string
  kmsKeyId?: string
  amount: number
  currency: string
  txId: string
}): Promise<void> {
  if (!params.kmsKeyId) {
    console.error(`SWEEP_ENQUEUE_ERROR: Account ${params.vAccountId} has no kmsKeyId — cannot sweep`)
    return
  }

  const queueUrl = process.env.SWEEP_QUEUE_URL || ''
  const result = await sendToQueue(queueUrl, { queue: 'v1-sweep-queue', ...params })
  if (!result.success) {
    console.error(`SWEEP_ENQUEUE_ERROR: Failed to queue sweep for tx ${params.txId}:`, result.e)
  }
}

// Debits the real on-chain fee once it's known — withdraw.ts only pre-debits the
// principal, so this is the sole fee charge, not a top-up. Idempotent via the same
// (account, txId) claim as applyBalanceChange; safe to no-op if unresolvable.
async function handleFeeEvent(body: IncomingBlockchainTransactionRequest): Promise<boolean> {
  const txId = body.txId || 'unknown'
  const asset = body.asset ?? body.currency ?? ''
  const resolvePayer = FEE_PAYER_RESOLVERS[asset]
  if (!resolvePayer) {
    console.log(`SKIP_FEE: No fee-payer resolver for asset '${asset}', tx ${txId}`)
    return true
  }

  const payerAddress = resolvePayer(body)
  if (!payerAddress) {
    console.log(`SKIP_FEE: Could not resolve payer address, tx ${txId}`)
    return true
  }

  const amount = Math.abs(parseFloat(body.amount))
  if (!Number.isFinite(amount)) {
    console.log(`SKIP_FEE: Invalid fee amount "${body.amount}", tx ${txId}`)
    return true
  }

  const account = await findAccountByAddress(payerAddress)
  if (!account) {
    console.log(`SKIP_FEE: No account for payer ${payerAddress}, tx ${txId}`)
    return true
  }

  return applyBalanceChange({
    account, direction: 'DEBIT', amount, currency: asset, txId, from: payerAddress, type: 'FEE',
  })
}

export const handleBalanceUpdate = async (message: any): Promise<boolean> => {
  const body: IncomingBlockchainTransactionRequest = message

  if (body.type === 'fee') return handleFeeEvent(body)

  // A single on-chain transfer can emit several events. `native` carries the
  // principal for a native-coin transfer, `trc20` carries it for a TRC-20
  // transfer (e.g. USDT_TRON)
  const PRINCIPAL_TYPES = new Set(['native', 'trc20'])
  if (body.type && !PRINCIPAL_TYPES.has(body.type)) {
    console.log(`SKIP_UNHANDLED_TYPE: Ignoring '${body.type}' event for tx ${body.txId ?? 'unknown'}`)
    return true
  }

  if (!body.address || body.amount == null) {
    console.error('VALIDATION_ERROR: Missing required fields (address, amount) for balance update')
    return false
  }

  // Tatum reports the amount signed from the watched address's perspective:
  // positive = funds received, negative = funds sent. Zero moves no balance.
  const rawAmount = parseFloat(body.amount)
  // `asset` is the specific token when one moved (e.g. USDT_TRON); `currency`
  // is only the underlying network's native currency (e.g. TRON) and is
  // wrong to use here for a token transfer.
  const currency = body.asset ?? body.currency ?? 'UNKNOWN'
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

  // `address` sent funds — nothing to do. Withdrawals are already debited atomically
  // by the withdraw route before broadcast, so debiting here would double-count.
  if (isOutgoing) return true

  // `address` received funds — credit it.
  if (!primary) return true

  // The subscription is address-based, so it fires for ANY asset touching
  // this address — not just the one this account is configured for (e.g.
  // TRX sent to activate a USDT_TRON account's deposit address). Crediting
  // that here would silently mix two different currencies into one flat
  // balance number, inflating it 1:1 regardless of actual value.
  if (primary.chain && currency.toUpperCase() !== primary.chain.toUpperCase()) {
    console.log(`SKIP_CURRENCY_MISMATCH: account ${primary.accountNo} is configured for ${primary.chain}, ignoring ${currency} deposit (tx ${txId})`)
    return true
  }

  const credited = await applyBalanceChange({
    account: primary, direction: 'CREDIT', amount, currency, txId,
    from: counterparties[0], to: body.address, blockNumber: body.blockNumber, index: body.index,
  })

  // Token deposits (e.g. USDT_TRON) get swept on-chain to the master account
  // right after crediting — native-chain deposits are left where they are.
  if (credited && !isNativeCurrency(currency)) {
    await enqueueSweep({
      vAccountId: primary.vAccountId,
      merchantId: primary.merchantId,
      senderAddress: body.address,
      kmsKeyId: primary.kmsKeyId,
      amount,
      currency,
      txId,
    })
  }

  return credited
}
