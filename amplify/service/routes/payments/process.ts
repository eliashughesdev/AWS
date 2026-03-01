import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { sendToQueue } from '../../../utils/sqs'

/**
 * Queues a saved-card payment for async processing
 */
export default class ProcessPaymentHandler {
  async execute(event: any) {
    console.log('DEBUG: ProcessPaymentHandler execution started.')
    console.log('DEBUG: Incoming Event:', JSON.stringify(event))
    console.log('DEBUG: Event Body:', JSON.stringify(event.body))

    const { paymentId, userId, amount, currency, provider = 'stripe', transactionId, offSession, ...additionalParams } = event.body

    console.log('DEBUG: Queueing payment for userId:', userId, 'paymentId:', paymentId, 'transactionId:', transactionId, 'amount:', amount, 'currency:', currency, 'provider:', provider)

    // Validate required parameters
    if (!paymentId || !userId || !amount || !currency) {
      return processError(100029, 'Missing required parameters: paymentId, userId, amount, or currency')
    }

    try {
      // transactionId is used for WebSocket correlation (what frontend uses to connect)
      // paymentId is used to look up the saved payment method
      const queueMessage = {
        queue: 'v1-payment-processing-queue',
        paymentId,
        transactionId: transactionId || paymentId,
        userId,
        amount,
        currency,
        provider,
        offSession: offSession || false,
        timestamp: Date.now(),
        ...additionalParams
      }

      console.log('DEBUG: Sending payment job to SQS queue:', process.env.PAYMENT_PROCESSING_QUEUE_URL)
      const queueUrl = process.env.PAYMENT_PROCESSING_QUEUE_URL || 'https://sqs.us-east-2.amazonaws.com/129364817855/v1-payment-processing-queue'
      const result = await sendToQueue(queueUrl, queueMessage)
      console.log('DEBUG: Payment job queued successfully. Job ID:', result.res?.MessageId)

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
      console.error('FATAL ERROR: Failed to queue payment:', err)
      console.error('Error stack:', err.stack)
      return processError(100002, 'Failed to queue payment for processing')
    }
  }
}
