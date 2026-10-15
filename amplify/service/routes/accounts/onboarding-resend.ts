import type { Context } from 'aws-lambda'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { queryRecord, transactWriteItems } from '../../../utils/db'
import { getUserStatus } from '../../../utils/cognito'
import { claimPointerItem, claimPointerKey, claimRecordId, createClaimToken, invalidateClaim } from '../../../utils/claimToken'
import { sendClaimInvite } from '../../../utils/claimInvite'
import { callerMerchant } from '../../../utils/caller'

type Event = {
  requestContext?: { authorizer?: { userId?: string, role?: string, authType?: string, merchantId?: string } }
  body: { externalId: string }
}

const mappingRecordId = (platform: string, externalId: string) => `EXT#${platform}#${externalId}`

/**
 * Reissues the password-claim link for a payer whose original expired or was
 * lost. Mints a fresh CLAIM record — only the token's hash was ever
 * persisted, so the original can't be recovered — and invalidates whatever
 * the CLAIM_POINTER names as the current one first, so a still-unexpired old
 * email can't be used to reset the password later. Without that, two live
 * tokens would each independently authorize AdminSetUserPassword.
 */
export default class OnboardingResendHandler {
  async execute(event: Event, context: Context) {
    // The merchant whose key signed the request, never a signed-in person (whose userId is a
    // Cognito sub). MAPPING rows are keyed on it, so it stays the merchant id for every key
    const caller = callerMerchant(event)
    if (caller.error) return caller.error
    const platform = caller.merchantId

    const { externalId } = event.body

    const mapping = await queryRecord(
      'v2CustomerTable',
      'id = :id AND sk = :sk',
      { ':id': mappingRecordId(platform, externalId), ':sk': 'MAPPING' }
    )
    if (!mapping.success) return processError(100003)

    const known = mapping.res?.[0]
    if (!known) return processError(100038)

    const { userId } = known

    // In this pool, Username === sub, so the mapping's userId doubles as it.
    const status = await getUserStatus(userId)
    if (status !== 'FORCE_CHANGE_PASSWORD') return processError(100039)

    const profile = await queryRecord(
      'v2CustomerTable',
      'id = :id AND sk = :sk',
      { ':id': userId, ':sk': 'USERPROFILE' }
    )
    const { firstName, email } = profile.res?.[0] ?? {}
    if (!email) return processError(100003)

    const pointerKey = claimPointerKey(userId)
    const pointer = await queryRecord(
      'v2CustomerTable',
      'id = :id AND sk = :sk',
      { ':id': pointerKey.id, ':sk': pointerKey.sk }
    )
    const previousHash = pointer.res?.[0]?.tokenHash
    if (previousHash) {
      const invalidated = await invalidateClaim(previousHash)
      if (!invalidated.success && invalidated.error?.name !== 'ConditionalCheckFailedException') {
        // Non-fatal: worst case the old token outlives this call, same as before this fix.
        console.error('ONBOARDING_RESEND: failed to invalidate previous claim', invalidated.error)
      }
    }

    const claim = createClaimToken()
    const written = await transactWriteItems({
      puts: [
        {
          tableName: 'v2CustomerTable',
          item: {
            id: claimRecordId(claim.tokenHash),
            sk: 'CLAIM',
            userId,
            email,
            expiresAt: claim.expiresAt,
            usedAt: null,
            created_at: Date.now(),
          },
        },
        { tableName: 'v2CustomerTable', item: claimPointerItem(userId, claim.tokenHash) },
      ],
    })
    if (!written.success) {
      console.error('ONBOARDING_RESEND: failed to persist claim record', written.error)
      return processError(100003)
    }

    const emailSent = await sendClaimInvite(email, firstName, claim)

    console.log(`ONBOARDING_RESEND: done userId=${userId} emailSent=${emailSent}`)

    return response({
      statusCode: 200,
      headers: null,
      bodyObject: {
        success: true,
        res: { data: { userId, claimToken: claim.token, claimExpiresAt: claim.expiresAt, emailSent } },
      },
    })
  }
}
