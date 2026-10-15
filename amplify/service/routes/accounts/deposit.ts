import { response } from '../../../utils/http'
import { putItem, queryItemFromIndex } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { sendToQueue } from '../../../utils/sqs'
import { fetchCryptoPrice } from '../../../utils/exchangeRate'
import { isNativeCurrency } from '../../../utils/currencies'
import { callerUser } from '../../../utils/caller'
import { checkKyc } from '../../../utils/kycPolicy'
import { newOperation, settleOperation } from '../../../utils/operations'

// Nothing was charged when the job could not be queued, so the caller may send it again
const NOT_QUEUED = 'the deposit could not be queued; nothing was charged'

/**
 * Queues a deposit for async processing.
 * Charges the user's saved card and credits the target account balance on success.
 */
export default class DepositHandler {
  async execute(event: any) {
    console.log('DEBUG: DepositHandler execution started.')

    const caller = callerUser(event)
    if (caller.error) return caller.error
    const { userId } = caller
    const { accountNumber, currency, amount, paymentId, transactionId, email } = event.body

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

    // Verify the account belongs to the requesting user
    if (accountRecord.id !== userId) {
      console.error(`ERROR: Account ${accountNumber} does not belong to user ${userId}`)
      return processError(100005)
    }

    // Validate currency matches — only for fiat accounts; crypto accounts always receive a fiat payment
    if (!accountRecord.chain && accountRecord.currency && accountRecord.currency !== currency) {
      console.error(`ERROR: Currency mismatch. Account currency: ${accountRecord.currency}, requested: ${currency}`)
      return processError(100006)
    }

    const vAccountId = accountRecord.vAccountId
    const accountChain = accountRecord.chain  // e.g. 'BTC', 'SOL', 'ETH' — only present for crypto accounts
    const effectiveTransactionId = transactionId || `dep_${Date.now()}`

    // Buying a token with a card is not suppported yet 
    if (accountChain && !isNativeCurrency(accountChain)) {
      console.error(`ERROR: Card deposits are not supported for currency ${accountChain}`)
      return processError(100009)
    }

    // The merchant's KYC policy for the currency bought (docs/public-api-plan.md D11), before the
    // card is charged. A fiat account is checked under its own currency
    const kycRefusal = await checkKyc({ userId, merchantId: accountRecord.merchantId, currency: accountChain ?? accountRecord.currency, operation: 'cardDeposit' })
    if (kycRefusal) return kycRefusal

    // For crypto accounts, convert fiat amount → crypto units using Binance rate
    let cryptoAmount: number | undefined
    let exchangeRate: number | undefined

    if (accountChain) {
      console.log(`DEBUG: Crypto account detected (chain: ${accountChain}). Fetching exchange rate ${accountChain}/${currency}`)
      try {
        exchangeRate = await fetchCryptoPrice(accountChain, currency)
      } catch (err) {
        console.error('ERROR: Exchange rate lookup failed:', err)
      }
      // A zero or unreadable rate would credit Infinity or NaN coins
      if (!exchangeRate || !(exchangeRate > 0)) {
        return processError(100002, `no ${accountChain} price in ${currency} could be read; nothing was charged`)
      }
      cryptoAmount = parseFloat((amount / exchangeRate).toFixed(8))
      console.log(`DEBUG: Exchange rate: 1 ${accountChain} = ${exchangeRate} ${currency} → crediting ${cryptoAmount} ${accountChain}`)
    }

    console.log('DEBUG: Account verified. vAccountId:', vAccountId, 'userId:', userId, 'amount:', amount, 'currency:', currency)

    // The deposit's record (utils/operations.ts), before the job can be charged. Refused for a
    // transactionId used before, so the first one's record is never overwritten
    const recorded = await putItem('v2CustomerTable', newOperation({
      userId,
      opId: effectiveTransactionId,
      kind: 'cardDeposit',
      accountNumber,
      currency: accountChain ?? accountRecord.currency,
      amount: cryptoAmount ?? amount,
      fiatAmount: amount,
      fiatCurrency: currency,
      paymentId,
    }), 'attribute_not_exists(id)')
    if (!recorded.success) {
      if (recorded.error?.name === 'ConditionalCheckFailedException') {
        console.error(`ERROR: Deposit ${effectiveTransactionId} already exists; nothing was charged`)
        return processError(100031, 'transactionId')
      }
      console.error('ERROR: The deposit could not be recorded:', recorded.error?.name)
      return processError(100002, NOT_QUEUED)
    }

    try {
      const queueMessage = {
        queue: 'v1-payment-processing-queue',
        paymentId,
        transactionId: effectiveTransactionId,
        userId,
        amount,
        currency,
        provider: 'clover',
        depositMode: true,
        vAccountId,
        offSession: false,
        timestamp: Date.now(),
        ...(email ? { email } : {}),
        ...(cryptoAmount !== undefined ? { cryptoAmount, cryptoCurrency: accountChain } : {}),
      }

      const queueUrl = process.env.PAYMENT_PROCESSING_QUEUE_URL || 'https://sqs.us-east-2.amazonaws.com/129364817855/v1-payment-processing-queue'
      console.log('DEBUG: Sending deposit job to SQS queue:', queueUrl)
      const result = await sendToQueue(queueUrl, queueMessage)

      if (result.success) {
        const jobId = result.res?.MessageId
        console.log('DEBUG: Deposit job queued successfully. Job ID:', jobId)
        return response({
          statusCode: 200,
          headers: null,
          bodyObject: {
            success: true,
            jobId,
            transactionId: effectiveTransactionId,
            status: 'queued',
            message: 'Deposit is being processed',
            res: {
              jobId,
              transactionId: effectiveTransactionId,
              status: 'queued',
              ...(cryptoAmount !== undefined ? { cryptoAmount, cryptoCurrency: accountChain, exchangeRate } : {}),
            }
          }
        })
      }

      console.error('ERROR: The queue refused the deposit job')
      await settleOperation(userId, effectiveTransactionId, { status: 'failed', code: 100002 })
      return processError(100002, NOT_QUEUED)
    } catch (err: any) {
      console.error('FATAL ERROR: Failed to queue deposit:', err)
      console.error('Error stack:', err.stack)
      await settleOperation(userId, effectiveTransactionId, { status: 'failed', code: 100002 })
      return processError(100002, NOT_QUEUED)
    }
  }
}
