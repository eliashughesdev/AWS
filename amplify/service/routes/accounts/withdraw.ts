import { response } from '../../../utils/http'
import { queryItemFromIndex, updateItem } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { sendToQueue } from '../../../utils/sqs'
import { fetchCryptoPrice } from '../../../utils/exchangeRate'
import { isNativeCurrency } from '../../../utils/currencies'
import { getMasterAccount } from '../../../utils/masterAccount'

/**
 * Queues a crypto withdrawal for async processing.
 * Atomically deducts the balance before queuing — rolls back on payout failure.
 */
export default class WithdrawHandler {
  async execute(event: any) {
    console.log('DEBUG: WithdrawHandler execution started.')
    console.log('DEBUG: Event Body:', JSON.stringify(event.body))

    const userId = event.requestContext?.authorizer?.userId
    const { accountNumber, currency, amount, cryptoAmount: directCryptoAmount, destinationAddress, transactionId } = event.body

    if (!userId) {
      return response({
        statusCode: 401,
        headers: null,
        bodyObject: { message: 'User ID not found in authorization context' }
      })
    }

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
    const kmsKeyId = accountRecord.kmsKeyId
    const senderAddress = accountRecord.depositAddress

    if (!accountChain) {
      console.error(`ERROR: Account ${accountNumber} is not a crypto account`)
      return processError(100006)
    }

    if (!kmsKeyId) {
      console.error(`ERROR: Account ${accountNumber} has no kmsKeyId — cannot create AWS KMS signing request`)
      return processError(100006)
    }

    // Token withdrawals (e.g. USDT_TRON) are signed from the master account,
    // not this address — only allowed once a master is actually configured
    // for this currency. Native currencies withdraw from their own address
    // as before and need no master at all.
    if (!isNativeCurrency(accountChain)) {
      const master = await getMasterAccount(accountChain)
      if (!master) {
        console.error(`ERROR: No master account configured for currency ${accountChain} — withdrawals unsupported`)
        return processError(100009)
      }
    }

    if (!destinationAddress) {
      console.error(`ERROR: Crypto withdrawal requires a destination address (chain: ${accountChain})`)
      return processError(100008)
    }

    // If a direct crypto amount is provided, skip the fiat conversion
    let cryptoAmount: number
    let exchangeRate: number
    if (directCryptoAmount != null) {
      cryptoAmount = parseFloat(parseFloat(directCryptoAmount).toFixed(8))
      exchangeRate = 1
      console.log(`DEBUG: Direct crypto withdrawal — debiting ${cryptoAmount} ${accountChain}`)
    } else {
      console.log(`DEBUG: Fetching exchange rate ${accountChain}/${currency}`)
      exchangeRate = await fetchCryptoPrice(accountChain, currency)
      cryptoAmount = parseFloat((amount / exchangeRate).toFixed(8))
      console.log(`DEBUG: Exchange rate: 1 ${accountChain} = ${exchangeRate} ${currency} → debiting ${cryptoAmount} ${accountChain}`)
    }

    const effectiveTransactionId = transactionId || `wdr_${Date.now()}`

    // Atomically deduct balance — fails if insufficient funds
    const deductResult = await updateItem({
      tableName: 'v1AccountBalanceTable',
      key: { id: vAccountId },
      updateExpression: 'SET #balance = #balance - :amount, #availableBalance = #availableBalance - :amount, #lastUpdated = :now',
      conditionExpression: '#availableBalance >= :amount',
      attributeNames: {
        '#balance': 'balance',
        '#availableBalance': 'availableBalance',
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
        kmsKeyId,
        senderAddress,
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
