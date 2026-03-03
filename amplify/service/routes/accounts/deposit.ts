import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { queryItemFromIndex } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { sendToQueue } from '../../../utils/sqs'

/**
 * Queues a deposit for async processing.
 * Charges the user's saved card and credits the target account balance on success.
 */
export default class DepositHandler {
  async execute(event: any, context: Context) {
    console.log('DEBUG: DepositHandler execution started.')
    console.log('DEBUG: Event Body:', JSON.stringify(event.body))

    const { accountNumber, currency, amount, paymentId, userId, transactionId } = event.body

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

    // Validate currency matches the account
    if (accountRecord.currency && accountRecord.currency !== currency) {
      console.error(`ERROR: Currency mismatch. Account currency: ${accountRecord.currency}, requested: ${currency}`)
      return processError(100006)
    }

    const vAccountId = accountRecord.vAccountId
    const effectiveTransactionId = transactionId || `dep_${Date.now()}`

    console.log('DEBUG: Account verified. vAccountId:', vAccountId, 'userId:', userId, 'amount:', amount, 'currency:', currency)

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
              status: 'queued'
            }
          }
        })
      }
    } catch (err: any) {
      console.error('FATAL ERROR: Failed to queue deposit:', err)
      console.error('Error stack:', err.stack)
      return processError(100029, 'Failed to queue deposit for processing')
    }
  }
}
