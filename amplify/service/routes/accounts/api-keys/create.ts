import { processError } from '../../../../errors/http'
import { createKey, signedInOnly } from '../../../../utils/apiKeys'
import { queryRecord } from '../../../../utils/db'
import { SYSTEM_MERCHANT_ID } from '../../../../utils/systemMerchant'

type Event = {
  requestContext?: { authorizer?: { userId?: string, authType?: string } }
  body: { name: string, permissions: string[], expiresAt?: string, ipAllowlist?: string[] }
}

/**
 * A new key for the signed-in user (docs/public-api-plan.md D2.6). Its secret is in this answer
 * only. The user needs a profile, which their first account creates: the authorizer lets no key
 * in for a user without one. A money-moving permission may be granted without KYC: each use is
 * checked against the merchant's KYC policy (D11).
 */
export default class CreateApiKeyHandler {
  async execute(event: Event) {
    const caller = signedInOnly(event.requestContext?.authorizer)
    if (caller.error) return caller.error
    const { userId } = caller

    const profile = await queryRecord('v2CustomerTable', 'id = :id AND sk = :sk', { ':id': userId, ':sk': 'USERPROFILE' })
    if (!profile.success) return processError(100003)
    const row = profile.res?.[0]
    if (!row || row.deleted_at) return processError(100063)

    // The body was checked against schemas/accounts/api-keys/create.json
    return createKey({
      ownerType: 'user',
      ownerId: userId,
      merchantId: row.merchantId ?? SYSTEM_MERCHANT_ID,
      ...event.body,
      createdBy: userId,
    })
  }
}
