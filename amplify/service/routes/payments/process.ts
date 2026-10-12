import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { sendToQueue } from '../../../utils/sqs'
import { resolvePayer } from '../../../utils/payer'

// Nothing was charged when the job could not be queued, so the caller may send it again
const NOT_QUEUED = 'the payment could not be queued; nothing was charged'

/**
 * Queues a saved-card payment for async processing
 */
export default class ProcessPaymentHandler {
  async execute(event: any) {
    console.log('DEBUG: ProcessPaymentHandler execution started.')

    const { paymentId, amount, currency, provider = 'stripe', transactionId, offSession, bin, email, firstName, lastName, returnUrl } = event.body

    // A signed-in user pays as themselves; a merchant's key names one of its own users (F3)
    const payer = await resolvePayer(event.requestContext?.authorizer, event.body.userId)
    if (payer.error) return payer.error
    const userId = payer.userId

    console.log('DEBUG: Queueing payment for userId:', userId, 'paymentId:', paymentId, 'transactionId:', transactionId, 'amount:', amount, 'currency:', currency, 'provider:', provider)

    try {
      // transactionId is used for WebSocket correlation (what frontend uses to connect)
      // paymentId is used to look up the saved payment method.
      // Only these fields reach the queue: the body is never spread into the message.
      const queueMessage = {
        queue: 'v1-payment-processing-queue',
        paymentId,
        transactionId: transactionId || paymentId,
        userId,
        amount,
        currency,
        provider,
        offSession: offSession || false,
        bin,
        email,
        firstName,
        lastName,
        returnUrl,
        timestamp: Date.now(),
      }

      console.log('DEBUG: Sending payment job to SQS queue:', process.env.PAYMENT_PROCESSING_QUEUE_URL)
      const queueUrl = process.env.PAYMENT_PROCESSING_QUEUE_URL || 'https://sqs.us-east-2.amazonaws.com/129364817855/v1-payment-processing-queue'
      const result = await sendToQueue(queueUrl, queueMessage)

      if (result.success) {
        const jobId = result.res?.MessageId
        console.log('DEBUG: Payment job queued successfully. Job ID:', jobId)
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

      console.error('ERROR: The queue refused the payment job')
      return processError(100002, NOT_QUEUED)
    } catch (err: any) {
      console.error('FATAL ERROR: Failed to queue payment:', err)
      console.error('Error stack:', err.stack)
      return processError(100002, NOT_QUEUED)
    }
  }
}
