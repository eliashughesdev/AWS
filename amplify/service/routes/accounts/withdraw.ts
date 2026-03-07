import { response } from '../../../utils/http'
import { queryItemFromIndex, updateItem } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { sendToQueue } from '../../../utils/sqs'
import { fetchCryptoPrice } from '../../../utils/exchangeRate'

/**
 * Queues a crypto withdrawal for async processing.
 * Atomically deducts the balance before queuing — rolls back on payout failure.
 */
export default class WithdrawHandler {
  async execute(event: any) {
    console.log('DEBUG: WithdrawHandler execution started.')
    console.log('DEBUG: Event Body:', JSON.stringify(event.body))

    const { accountNumber, currency, amount, userId, destinationAddress, transactionId } = event.body

    // Look up account via GSI to verify it exists
    const account = await queryItemFromIndex({
      tableName: 'v2CustomerTable',
      indexName: 'v1v2CustomerTableToAccountId',
      keyConditionExpression: '#sk = :accountNumber',
      attributeNames: {
        '#sk': 'sk',
      },
      attributeValues: {
        ':accountNumber': `ACCOUNT#${accountNumber}`,
      }
    })

    if (!account.success || !account.res || account.res.length === 0) {
      console.error(`ERROR: Account not found for accountNumber: ${accountNumber}`)
      return processError(100001)
    }

    const accountRecord = account.res[0]

    if (accountRecord.id !== userId) {
      console.error(`ERROR: Account ${accountNumber} does not belong to user ${userId}`)
      return processError(100005)
    }

    const accountChain = accountRecord.chain  // e.g. 'BTC', 'SOL', 'ETH', 'TRON'
    const vAccountId = accountRecord.vAccountId
    const signatureId = accountRecord.signatureId

    if (!accountChain) {
      console.error(`ERROR: Account ${accountNumber} is not a crypto account`)
      return processError(100006)
    }

    if (!signatureId) {
      console.error(`ERROR: Account ${accountNumber} has no signatureId — cannot create KMS signing request`)
      return processError(100006)
    }

    if (!destinationAddress) {
      console.error(`ERROR: Crypto withdrawal requires a destination address (chain: ${accountChain})`)
      return processError(100008)
    }

    // Convert fiat amount → crypto units using Binance rate
    console.log(`DEBUG: Fetching exchange rate ${accountChain}/${currency}`)
    const exchangeRate = await fetchCryptoPrice(accountChain, currency)
    const cryptoAmount = parseFloat((amount / exchangeRate).toFixed(8))
    console.log(`DEBUG: Exchange rate: 1 ${accountChain} = ${exchangeRate} ${currency} → debiting ${cryptoAmount} ${accountChain}`)

    const effectiveTransactionId = transactionId || `wdr_${Date.now()}`

    // Atomically deduct balance — fails if insufficient funds
    const deductResult = await updateItem({
      tableName: 'v1AccountBalanceTable',
      key: { id: vAccountId },
      updateExpression: 'SET #balance = #balance - :amount, #lastUpdated = :now',
      conditionExpression: '#balance >= :amount',
      attributeNames: {
        '#balance': 'balance',
        '#lastUpdated': 'lastUpdated',
      },
      attributeValues: {
        ':amount': cryptoAmount,
        ':now': new Date().toISOString(),
      },
    })

    if (!deductResult.success) {
      if (deductResult.error?.name === 'ConditionalCheckFailedException') {
        console.error(`ERROR: Insufficient balance. vAccountId: ${vAccountId}, requested: ${cryptoAmount} ${accountChain}`)
        return processError(100007)
      }
      console.error('ERROR: Failed to deduct balance:', deductResult.error)
      return processError(100029, 'Failed to process withdrawal')
    }

    console.log(`DEBUG: Balance deducted. vAccountId: ${vAccountId}, cryptoAmount: ${cryptoAmount} ${accountChain}`)

    try {
      const queueMessage = {
        queue: 'v1-withdrawal-processing-queue',
        transactionId: effectiveTransactionId,
        userId,
        vAccountId,
        chain: accountChain,
        cryptoAmount,
        destinationAddress,
        signatureId,
        exchangeRate,
        originalAmount: amount,
        originalCurrency: currency,
        timestamp: Date.now(),
      }

      const queueUrl = process.env.WITHDRAWAL_QUEUE_URL || ''
      console.log('DEBUG: Sending withdrawal job to SQS queue:', queueUrl)
      const result = await sendToQueue(queueUrl, queueMessage)

      if (result.success) {
        const jobId = result.res?.MessageId
        console.log('DEBUG: Withdrawal job queued successfully. Job ID:', jobId)
        return response({
          statusCode: 200,
          headers: null,
          bodyObject: {
            success: true,
            jobId,
            transactionId: effectiveTransactionId,
            status: 'queued',
            message: 'Withdrawal is being processed',
            res: {
              jobId,
              transactionId: effectiveTransactionId,
              status: 'queued',
              cryptoAmount,
              cryptoCurrency: accountChain,
              exchangeRate,
            }
          }
        })
      }

      throw new Error('SQS send returned no success')
    } catch (err: any) {
      // Balance was deducted but queuing failed — credit it back
      console.error('ERROR: Failed to queue withdrawal, rolling back balance deduction:', err)
      await updateItem({
        tableName: 'v1AccountBalanceTable',
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
      return processError(100029, 'Failed to queue withdrawal for processing')
    }
  }
}
