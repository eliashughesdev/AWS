import { processError } from '../../../../errors/http'
import { createKey, signedInOnly } from '../../../../utils/apiKeys'
import { getMerchant } from '../../../../utils/merchant'

type Event = {
  requestContext?: { authorizer?: { userId?: string, authType?: string } }
  body: { merchantId: string, name: string, permissions: string[], expiresAt?: string, ipAllowlist?: string[] }
}

/**
 * Staff create a key for a merchant (docs/public-api-plan.md D2.6, D9): merchant permissions
 * only, for an active merchant. The secret is in this answer only, for staff to hand over; the
 * merchant's active team is told a key was made, never its secret.
 */
export default class CreateMerchantApiKeyHandler {
  async execute(event: Event) {
    const caller = signedInOnly(event.requestContext?.authorizer)
    if (caller.error) return caller.error
    const { merchantId, ...key } = event.body

    const merchant = await getMerchant(merchantId)
    if (!merchant.success) return processError(100003)
    if (merchant.res?.status !== 'active') return processError(100040)

    return createKey({ ownerType: 'merchant', ownerId: merchantId, merchantId, ...key, createdBy: caller.userId })
  }
}
