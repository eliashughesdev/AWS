import { getRecord, updateItem, putItem } from '../../../utils/db'

interface IncomingBlockchainTransactionRequest {
  date: number;
  amount: string;
  currency: string;
  subscriptionType: string;
  accountId: string;
  reference?: string;
  txId?: string;
  blockHash?: string;
  blockHeight: number;
  from?: string;
  to: string;
  index?: number;
  queue?: string;
}

const BALANCE_TABLE_NAME = 'v1AccountBalanceTable'

// Handler for v1-webhook-queue: Updates account balance
export const handleBalanceUpdate = async (message: any): Promise<boolean> => {
  // Validate that body matches expected structure
  const body: IncomingBlockchainTransactionRequest = message
  if (!body.accountId || !body.amount) {
    console.error('VALIDATION_ERROR: Missing required fields (accountId, amount) for balance update')
    return false
  }

  const vAccountId = body.accountId
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
      return false
    }

    console.log('DB_READ_SUCCESS: Retrieved record:', currentBalanceResult.res)

    const currentBalance = parseFloat(currentBalanceResult.res.balance || '0')
    const newBalance = currentBalance + amountToAdd

    console.log(`BALANCE_CALC: Current ${currentBalance.toFixed(2)} + Incoming ${amountToAdd.toFixed(2)} = New ${newBalance.toFixed(2)}`)

    const updateParams = {
      tableName: BALANCE_TABLE_NAME,
      key: { id: vAccountId },
      updateExpression: 'SET #balance = :newBalance, #lastUpdated = :now',
      attributeNames: {
        '#balance': 'balance',
        '#lastUpdated': 'lastUpdated',
      },
      attributeValues: {
        ':newBalance': newBalance,
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
        from: body.from,
        to: body.to,
        blockHeight: body.blockHeight,
        blockHash: body.blockHash,
        reference: body.reference,
        createdAt,
      })
    } else {
      console.error(`DB_ERROR: Failed to update balance document for ${vAccountId} and TX ${txId}. Update result:`, updateResult)
      return false
    }
  } catch (e) {
    console.error(`CRITICAL_ERROR: Failed to process balance update for TX ${txId} (Account ${vAccountId}). Exception caught:`, e)
    return false
  }

  console.log(`--- Finished Processing TX [${txId}] ---`)
  return true
}
