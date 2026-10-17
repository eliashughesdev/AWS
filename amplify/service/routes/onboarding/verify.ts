import type { Context } from 'aws-lambda'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { queryRecord } from '../../../utils/db'
import { loadClaim } from '../../../utils/claimToken'

type Event = {
  body: { token: string }
}

/**
 * Unauthenticated. Reports whether a claim link is still usable and who it is
 * for, so the set-password screen can greet the payer by name before asking for
 * anything. Does not consume the token — only /onboarding/claim does that.
 */
export default class OnboardingVerifyHandler {
  async execute(event: Event, context: Context) {
    const claim = await loadClaim(event.body.token)
    if (!claim.ok) {
      console.log(`ONBOARDING_VERIFY: rejected with ${claim.code}`)
      return processError(claim.code)
    }

    const profile = await queryRecord(
      'v2CustomerTable',
      'id = :id AND sk = :sk',
      { ':id': claim.record.userId, ':sk': 'USERPROFILE' }
    )

    return response({
      statusCode: 200,
      headers: null,
      bodyObject: {
        success: true,
        res: {
          data: {
            email: claim.record.email,
            firstName: profile.res?.[0]?.firstName ?? null,
            expiresAt: claim.record.expiresAt,
          },
        },
      },
    })
  }
}
