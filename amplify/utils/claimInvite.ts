import { ClaimToken } from './claimToken'
import { brandName } from './config'
import { getEmailProvider } from './EmailProvider'
import { claimInviteEmail } from './emailTemplates'

/**
 * Sends the password-claim invite email. Not fatal on failure — the token is
 * already persisted and (for onboarding) also returned to the caller, so a
 * failed send doesn't stukc the user.
 *  */
export const sendClaimInvite = async (email: string, firstName: string | null | undefined, claim: ClaimToken): Promise<boolean> => {
  try {
    const base = process.env.FRONTEND_URL?.replace(/\/+$/, '')
    if (!base) throw new Error('FRONTEND_URL is not set')

    const message = claimInviteEmail({
      brand: brandName(),
      firstName,
      link: `${base}/v2/set-password?token=${encodeURIComponent(claim.token)}`,
      expiresAt: claim.expiresAt,
    })
    await getEmailProvider().sendEmail(email, message.subject, message.text, message.html)
    console.log(`CLAIM_INVITE: sent to ${email}`)
    return true
  } catch (err) {
    console.error('CLAIM_INVITE: send failed', err)
    return false
  }
}
