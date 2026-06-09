import { getRecord, updateItem, putItem, queryItemFromIndex } from '../../../utils/db'

interface IncomingBlockchainTransactionRequest {
  // ADDRESS_TRANSACTION fields (on-chain subscription webhook)
  address: string;          // subscribed deposit address
  counterAddress?: string;  // sender address (not present on UTXO chains)
  amount: string;
  currency: string;
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

  const vAccountId: string = lookup.res[0].vAccountId
  const amountToAdd = parseFloat(body.amount)
  const txId = body.txId || 'unknown'

  console.log(`--- Processing Incoming TX [${txId}] for Account [${vAccountId}] ---`)
  console.log('Incoming Payload:', body)
  console.log(`Amount to Add: ${amountToAdd.toFixed(2)} ${body.currency}`)

  try {
    console.log(`DB_READ: Fetching current balance for ${vAccountId} from ${BALANCE_TABLE_NAME}...`)
    const currentBalanceResult = await getRecord(BALANCE_TABLE_NAME, vAccountId)

    if (!currentBalanceResult.success || !currentBalanceResult.res) {
      console.error(`DB_ERROR: Balance record not found for vAccountId: ${vAccountId}. Cannot update balance. Read result:`, currentBalanceResult)
      const createdAt = new Date().toISOString()
      await putItem('v1TransactionLogsTable', {
        id: vAccountId,
        sk: `TX#${createdAt}#${txId}`,
        txId,
        type: 'DEPOSIT_FAILED',
        reason: 'BALANCE_RECORD_NOT_FOUND',
        amount: amountToAdd,
        currency: body.currency,
        from: body.counterAddress,
        to: body.address,
        blockNumber: body.blockNumber,
        index: body.index,
        createdAt,
      })
      return false
    }

    console.log('DB_READ_SUCCESS: Retrieved record:', currentBalanceResult.res)

    const currentBalance = parseFloat(currentBalanceResult.res.balance || '0')
    const currentAvailable = parseFloat(currentBalanceResult.res.availableBalance || '0')
    const newBalance = currentBalance + amountToAdd
    const newAvailable = currentAvailable + amountToAdd

    console.log(`BALANCE_CALC: Current ${currentBalance.toFixed(2)} + Incoming ${amountToAdd.toFixed(2)} = New ${newBalance.toFixed(2)}`)

    const updateParams = {
      tableName: BALANCE_TABLE_NAME,
      key: { id: vAccountId },
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
    }

    console.log('DB_WRITE: Preparing to update balance with parameters:', updateParams)

    const updateResult = await updateItem(updateParams)

    if (updateResult.success) {
      console.log(`TX_SUCCESS: Balance for ${vAccountId} successfully updated to ${newBalance.toFixed(2)} ${body.currency}. TX: ${txId}`)

      const createdAt = new Date().toISOString()
      await putItem('v1TransactionLogsTable', {
        id: vAccountId,
        sk: `TX#${createdAt}#${txId}`,
        txId,
        type: 'DEPOSIT',
        amount: amountToAdd,
        currency: body.currency,
        from: body.counterAddress,
        to: body.address,
        blockNumber: body.blockNumber,
        index: body.index,
        createdAt,
      })
    } else {
      console.error(`DB_ERROR: Failed to update balance document for ${vAccountId} and TX ${txId}. Update result:`, updateResult)
      const createdAt = new Date().toISOString()
      await putItem('v1TransactionLogsTable', {
        id: vAccountId,
        sk: `TX#${createdAt}#${txId}`,
        txId,
        type: 'DEPOSIT_FAILED',
        reason: 'BALANCE_UPDATE_FAILED',
        amount: amountToAdd,
        currency: body.currency,
        from: body.counterAddress,
        to: body.address,
        blockNumber: body.blockNumber,
        index: body.index,
        createdAt,
      })
      return false
    }
  } catch (e) {
    console.error(`CRITICAL_ERROR: Failed to process balance update for TX ${txId} (Account ${vAccountId}). Exception caught:`, e)
    return false
  }

  console.log(`--- Finished Processing TX [${txId}] ---`)
  return true
}
