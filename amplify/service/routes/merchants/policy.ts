import type { Context } from 'aws-lambda'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { putItem } from '../../../utils/db'
import { isNativeCurrency, networkFor } from '../../../utils/currencies'
import { getMerchant } from '../../../utils/merchant'

type Event = {
  requestContext?: { authorizer?: { userId?: string } }
  body: { merchantId: string, thresholds: Record<string, number> }
}

/**
 * Sets a merchant's treasury-send thresholds (staff only), one per token
 * currency: below it one approver other than the initiator is enough; at or
 * above it — counting the last 24h of sends — every approver must approve.
 * Replaces the whole set; a currency left out can no longer be sent.
 */
export default class SetTreasuryPolicyHandler {
  async execute(event: Event, context: Context) {
    const staffUserId = event.requestContext?.authorizer?.userId
    const { merchantId, thresholds } = event.body

    const entries = thresholds && typeof thresholds === 'object' && !Array.isArray(thresholds) ? Object.entries(thresholds) : []
    const valid = entries.length > 0 && entries.every(([currency, threshold]) =>
      networkFor(currency) && !isNativeCurrency(currency) && typeof threshold === 'number' && threshold > 0)
    if (!valid) return processError(100031, 'thresholds')

    const merchant = await getMerchant(merchantId)
    if (!merchant.success) return processError(100003)
    if (merchant.res?.status !== 'active') return processError(100040)

    const normalized = Object.fromEntries(entries.map(([currency, threshold]) => [currency.toUpperCase(), threshold]))
    const saved = await putItem('v1MerchantTable', {
      id: merchantId,
      sk: 'POLICY#TREASURY_SEND',
      thresholds: normalized,
      updatedBy: staffUserId,
      updatedAt: new Date().toISOString(),
    })
    if (!saved.success) return processError(100003)

    console.log(`TREASURY_POLICY: ${merchantId} thresholds ${JSON.stringify(normalized)} by ${staffUserId}`)

    return response({
      statusCode: 200,
      headers: null,
      bodyObject: { success: true, merchantId, thresholds: normalized },
    })
  }
}
