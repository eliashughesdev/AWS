import type { Context } from 'aws-lambda'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { updateItem } from '../../../utils/db'
import { claimRecordId, hashClaimToken, loadClaim } from '../../../utils/claimToken'
import { adminSetEmailVerified, adminSetUserPassword } from '../../../utils/cognito'

type Event = {
  body: { token: string, password: string }
}

/**
 * Unauthenticated: the user has no session and no password yet, so the one-time
 * token is the only credential. Sets the chosen password as permanent, which also
 * moves the Cognito user out of FORCE_CHANGE_PASSWORD so the client can sign in
 * straight away.
 */
export default class OnboardingClaimHandler {
  async execute(event: Event, context: Context) {
    // Both are non-empty strings (schemas/onboarding/claim.json); the token's format is loadClaim's
    const { token, password } = event.body

    const claim = await loadClaim(token)
    if (!claim.ok) {
      console.log(`ONBOARDING_CLAIM: rejected with ${claim.code}`)
      return processError(claim.code)
    }

    const { userId, email } = claim.record
    const recordKey = { id: claimRecordId(hashClaimToken(token)), sk: 'CLAIM' }

    // ivalidates the token
    const burned = await updateItem({
      tableName: 'v2CustomerTable',
      key: recordKey,
      updateExpression: 'SET #usedAt = :now',
      conditionExpression: 'attribute_not_exists(#usedAt) OR attribute_type(#usedAt, :nullType)',
      attributeNames: { '#usedAt': 'usedAt' },
      attributeValues: { ':now': Date.now(), ':nullType': 'NULL' },
    })

    if (!burned.success) {
      if (burned.error?.name === 'ConditionalCheckFailedException') {
        console.log('ONBOARDING_CLAIM: token was claimed concurrently')
        return processError(100036)
      }
      console.error('ONBOARDING_CLAIM: failed to burn the token', burned.error)
      return processError(100003)
    }

    try {
      await adminSetUserPassword(userId, password)
    } catch (err: any) {
      // Give the token back — a rejected password must not cost the payer their link.
      await this.unburn(recordKey)

      if (err?.name === 'InvalidPasswordException') {
        console.log('ONBOARDING_CLAIM: password rejected by the pool policy')
        return processError(100037, err.message)
      }
      console.error('ONBOARDING_CLAIM: AdminSetUserPassword failed', err)
      return processError(100003)
    }

    try {
      await adminSetEmailVerified(userId)
    } catch (err) {
      // The payer can already sign in; losing the verified flag is not worth failing on.
      console.error('ONBOARDING_CLAIM: could not mark the email verified (non-fatal)', err)
    }

    console.log(`ONBOARDING_CLAIM: done userId=${userId}`)

    return response({
      statusCode: 200,
      headers: null,
      bodyObject: { success: true, res: { data: { email } } },
    })
  }

  private async unburn(key: Record<string, any>) {
    const reverted = await updateItem({
      tableName: 'v2CustomerTable',
      key,
      updateExpression: 'SET #usedAt = :null',
      attributeNames: { '#usedAt': 'usedAt' },
      attributeValues: { ':null': null },
    })
    if (!reverted.success) {
      console.error('ONBOARDING_CLAIM: could not release the token — it is now stuck as used', reverted.error)
    }
  }
}
