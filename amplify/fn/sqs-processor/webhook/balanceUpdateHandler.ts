import { getRecord, updateItem, putItem, queryItemFromIndex } from '../../../utils/db'

interface IncomingBlockchainTransactionRequest {
  // ADDRESS_TRANSACTION fields (on-chain subscription webhook)
  address: string;          // subscribed deposit address
  counterAddress?: string;  // sender address (not present on UTXO chains)
  amount: string;
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

// Handler for v1-webhook-queue: Updates account balance
export const handleBalanceUpdate = async (message: any): Promise<boolean> => {
  const body: IncomingBlockchainTransactionRequest = message

  // Tatum emits a separate webhook per asset movement for a single on-chain tx.
  // The `fee` event carries no `address` and amount "0" — it only reports the
  // network fee and must not affect the balance. Only the `native` transfer does.
  if (body.type && body.type !== 'native') {
    console.log(`SKIP_NON_NATIVE: Ignoring '${body.type}' event for tx ${body.txId ?? 'unknown'}`)
    return true
  }

  if (!body.address || !body.amount) {
    console.error('VALIDATION_ERROR: Missing required fields (address, amount) for balance update')
    return false
  }

  const lookup = await queryItemFromIndex({
    tableName: 'v2CustomerTable',
    indexName: 'v1v2CustomerTableByDepositAddress',
    keyConditionExpression: 'depositAddress = :addr',
    attributeNames: undefined,
    attributeValues: { ':addr': body.address },
  })

  if (!lookup.success || !lookup.res?.length) {
    console.error(`ACCOUNT_NOT_FOUND: No account found for depositAddress: ${body.address}`)
    return false
  }

  const accountRecord = lookup.res[0]
  const isNonCustodial = accountRecord.walletType === 'non-custodial'

  // Non-custodial accounts have no vAccountId — use accountNo as the balance table key.
  const balanceKey: string = isNonCustodial ? accountRecord.accountNo : accountRecord.vAccountId

  const amountToAdd = parseFloat(body.amount)
  const currency    = body.currency ?? body.asset ?? 'UNKNOWN'
  const txId = body.txId || 'unknown'

  console.log(`--- Processing Incoming TX [${txId}] for Account [${balanceKey}] (walletType: ${isNonCustodial ? 'non-custodial' : 'custodial'}) ---`)
  console.log('Incoming Payload:', body)
  console.log(`Amount to Add: ${amountToAdd.toFixed(2)} ${currency}`)

  try {
    const createdAt = new Date().toISOString()
    const claimResult = await putItem(
      'v1TransactionLogsTable',
      {
        id: balanceKey,
        sk: `TX#${txId}`,
        txId,
        type: 'DEPOSIT',
        amount: amountToAdd,
        currency,
        from: body.counterAddress,
        to: body.address,
        blockNumber: body.blockNumber,
        index: body.index,
        createdAt,
      },
      'attribute_not_exists(sk)'
    )

    if (!claimResult.success) {
      if (claimResult.error?.name === 'ConditionalCheckFailedException') {
        console.log(`DUPLICATE_TX: Transaction ${txId} already processed for account ${balanceKey}. Skipping.`)
        return true
      }
      console.error(`LOG_ERROR: Failed to write transaction log for TX ${txId}:`, claimResult.error)
      return false
    }

    console.log(`DB_READ: Fetching current balance for ${balanceKey} from ${BALANCE_TABLE_NAME}...`)
    const currentBalanceResult = await getRecord(BALANCE_TABLE_NAME, balanceKey)

    if (!currentBalanceResult.success || !currentBalanceResult.res) {
      console.error(`DB_ERROR: Balance record not found for key: ${balanceKey}. Cannot update balance.`)
      return false
    }

    console.log('DB_READ_SUCCESS: Retrieved record:', currentBalanceResult.res)

    const currentBalance = parseFloat(currentBalanceResult.res.balance || '0')
    const currentAvailable = parseFloat(currentBalanceResult.res.availableBalance || '0')
    const newBalance = currentBalance + amountToAdd
    const newAvailable = currentAvailable + amountToAdd

    console.log(`BALANCE_CALC: Current ${currentBalance.toFixed(2)} + Incoming ${amountToAdd.toFixed(2)} = New ${newBalance.toFixed(2)}`)

    const updateResult = await updateItem({
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

    if (updateResult.success) {
      console.log(`TX_SUCCESS: Balance for ${balanceKey} updated to ${newBalance.toFixed(2)} ${currency}. TX: ${txId}`)
    } else {
      console.error(`DB_ERROR: Failed to update balance for ${balanceKey}, TX ${txId}:`, updateResult.error)
      return false
    }
  } catch (e) {
    console.error(`CRITICAL_ERROR: Failed to process balance update for TX ${txId} (Account ${balanceKey}). Exception caught:`, e)
    return false
  }

  console.log(`--- Finished Processing TX [${txId}] for Account [${balanceKey}] ---`)
  return true
}
