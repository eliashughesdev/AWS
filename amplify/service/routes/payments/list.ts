import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { queryRecord } from '../../../utils/db'
import { processError } from '../../../errors/http'

/**
 * Lists payment methods for a user
 */
export default class ListPaymentsHandler {
  async execute(event: any, context: Context) {
    console.log('DEBUG: ListPaymentsHandler execution started.')

    // The query string is shaped by schemas/payments/list.json
    const userId = event.queryStringParameters.userId

    try {
      console.log(`DEBUG: Querying payment methods for user: ${userId}`)

      // Query v2CustomerTable by userId (partition key)
      const queryResult = await queryRecord(
        'v2CustomerTable',
        'id = :userId AND begins_with(sk, :paymentPrefix)',
        {
          ':userId': userId,
          ':paymentPrefix': 'PAYMENT#'
        }
      )

      if (!queryResult.success) {
        console.error('Failed to query payment methods')
        return processError(100003)
      }

      // Transform the results to match frontend expectations
      const paymentMethods = (queryResult.res || []).map((record: any) => {
        // Extract paymentId from sk (format: "PAYMENT#uuid")
        const paymentId = record.sk.replace('PAYMENT#', '')

        // Parse cardData to extract card details
        const cardData = record.cardData || {}

        return {
          id: paymentId,
          lastFour: cardData.lastFour || cardData.last4 || 'N/A',
          bin: cardData.bin || null,
          cardType: cardData.cardType || cardData.brand || 'unknown',
          createdAt: record.created_at,
          // True when at least one processor has stored credentials for this card.
          // Processors save their credentials under a "{provider}Credentials" key
          // (e.g. stripeCredentials, cloverCredentials) so this check stays valid
          // as new processors are added without touching this file.
          isRecurringReady: Object.keys(record).some(k => k.endsWith('Credentials')),
        }
      })

      console.log(`DEBUG: Found ${paymentMethods.length} payment methods`)

      return response({
        statusCode: 200,
        headers: null,
        bodyObject: {
          success: true,
          res: paymentMethods
        }
      })
    } catch (err) {
      console.error('FATAL ERROR: Failed to list payment methods:', err)
      return processError(100002, 'Failed to list payment methods')
    }
  }
}
