import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { sendToQueue } from '../../../utils/sqs'

// Nothing was charged when the job could not be queued, so the caller may send it again
const NOT_QUEUED = 'the payment could not be queued; nothing was charged'

// The schema lets cardData.cardData be one ev: value or a JSON object; the object must hold
// number, cvc and expiry.month/year as ciphertext and nothing else, or a plain card would be
// queued and logged (pci-remediation-plan.md F6 step 4)
export const isEncryptedCard = (cardData: string): boolean => {
  if (cardData.startsWith('ev:')) return true
  let card: any
  try {
    card = JSON.parse(cardData)
  } catch {
    return false
  }
  const encrypted = (value: unknown) => typeof value === 'string' && value.startsWith('ev:')
  const keys = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort().join() : ''
  return keys(card) === 'cvc,expiry,number' && keys(card.expiry) === 'month,year' &&
    [card.number, card.cvc, card.expiry.month, card.expiry.year].every(encrypted)
}

/**
 * Queues a guest (widget) payment for async processing.
 * Card data is provided inline and encrypted client-side via Evervault SDK.
 * Cards are never saved to the database — only the transaction is logged.
 */
export default class ProcessGuestPaymentHandler {
  async execute(event: any) {
    console.log('DEBUG: ProcessGuestPaymentHandler execution started.')

    // The body is shaped by schemas/payments/process/guest.json
    const { cardData, userId, amount, currency, provider = 'stripe', transactionId } = event.body

    if (!isEncryptedCard(cardData.cardData)) {
      return processError(100031, 'cardData.cardData')
    }

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

      if (result.success) {
        const jobId = result.res?.MessageId
        console.log('DEBUG: Guest payment job queued successfully. Job ID:', jobId)
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

      console.error('ERROR: The queue refused the guest payment job')
      return processError(100002, NOT_QUEUED)
    } catch (err: any) {
      console.error('FATAL ERROR: Failed to queue guest payment:', err)
      console.error('Error stack:', err.stack)
      return processError(100002, NOT_QUEUED)
    }
  }
}
