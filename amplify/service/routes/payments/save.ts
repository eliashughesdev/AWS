import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { transactWriteItems } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { resolvePayer } from '../../../utils/payer'

/**
 * Saves payment card data
 */
export default class SavePaymentHandler {
  async execute(event: any, context: Context) {
    console.log('DEBUG: SavePaymentHandler execution started.')

    // paymentMethod is shaped and its cardData is Evervault ciphertext (schemas/payments/save.json)
    const { paymentMethod } = event.body

    // Whose card this is is the caller's to prove (F3)
    const payer = await resolvePayer(event.requestContext?.authorizer, event.body.userId)
    if (payer.error) return payer.error
    const userId = payer.userId

    const paymentId = crypto.randomUUID()
    const paymentRecord: Record<string, any> = {
      id: userId,
      sk: `PAYMENT#${paymentId}`,
      cardData: paymentMethod,
      created_at: Date.now(),
      updated_at: Date.now(),
    }

    // Never the record: it holds the card
    console.log(`DEBUG: Saving card ${paymentId} for ${userId}`)

    try {
      const itemsToTransact = [
        { tableName: 'v2CustomerTable', item: paymentRecord },
      ]

      console.log('DEBUG: Attempting to save payment record...')

      const transactionResult = await transactWriteItems({ puts: itemsToTransact })

      if (!transactionResult.success || !transactionResult.res) {
        console.log('Failed to save payment record')
        return processError(100003)
      }

      console.log('DEBUG: Payment save successful.')
      return response({
        statusCode: 200,
        headers: null,
        bodyObject: {
          success: true,
          res: {
            paymentId
          }
        }
      })
    } catch (err) {
      console.error('FATAL ERROR: Payment save error:', err)
      return processError(100002, 'Failed to save payment')
    }
  }
}
