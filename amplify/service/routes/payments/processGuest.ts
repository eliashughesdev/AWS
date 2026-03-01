import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { sendToQueue } from '../../../utils/sqs'

/**
 * Queues a guest (widget) payment for async processing.
 * Card data is provided inline and encrypted client-side via Evervault SDK.
 * Cards are never saved to the database — only the transaction is logged.
 */
export default class ProcessGuestPaymentHandler {
  async execute(event: any) {
    console.log('DEBUG: ProcessGuestPaymentHandler execution started.')
    console.log('DEBUG: Incoming Event:', JSON.stringify(event))
    console.log('DEBUG: Event Body:', JSON.stringify(event.body))

    const { cardData, userId, amount, currency, provider = 'stripe', transactionId } = event.body

    const effectiveTransactionId = transactionId || `txn_${Date.now()}`
    // Synthetic paymentId used only for logging — never persisted to DynamoDB
    const paymentId = `WIDGET#${effectiveTransactionId}`

    console.log('DEBUG: Queueing guest payment for userId:', userId, 'paymentId:', paymentId, 'transactionId:', effectiveTransactionId, 'amount:', amount, 'currency:', currency, 'provider:', provider)

    try {
      const queueMessage = {
        queue: 'v1-payment-processing-queue',
        paymentId,
        transactionId: effectiveTransactionId,
        userId,
        amount,
        currency,
        provider,
        guestMode: true,
        cardData,
        offSession: false,
        timestamp: Date.now(),
      }

      console.log('DEBUG: Sending guest payment job to SQS queue:', process.env.PAYMENT_PROCESSING_QUEUE_URL)
      const queueUrl = process.env.PAYMENT_PROCESSING_QUEUE_URL || 'https://sqs.us-east-2.amazonaws.com/129364817855/v1-payment-processing-queue'
      const result = await sendToQueue(queueUrl, queueMessage)
      console.log('DEBUG: Guest payment job queued successfully. Job ID:', result.res?.MessageId)

      if (result.success) {
        const jobId = result.res?.MessageId
        return response({
          statusCode: 200,
          headers: null,
          bodyObject: {
            success: true,
            jobId,
            status: 'queued',
            message: 'Payment is being processed',
            res: {
              jobId,
              paymentId,
              status: 'queued'
            }
          }
        })
      }
    } catch (err: any) {
      console.error('FATAL ERROR: Failed to queue guest payment:', err)
      console.error('Error stack:', err.stack)
      return processError(100002, 'Failed to queue payment for processing')
    }
  }
}
