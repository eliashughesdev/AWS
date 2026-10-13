import type { Context } from 'aws-lambda'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { queryRecord, transactWriteItems } from '../../../utils/db'
import { addUserToGroup, adminCreateUser, EMAIL_RE, findUserByEmail } from '../../../utils/cognito'
import { claimPointerItem, claimRecordId, createClaimToken } from '../../../utils/claimToken'
import { sendClaimInvite } from '../../../utils/claimInvite'
import { brandName } from '../../../utils/config'
import { getMerchant } from '../../../utils/merchant'

type Event = {
  requestContext?: { authorizer?: { userId?: string } }
  body: { merchantId: string, email: string, name: string, roles: string[] }
}

/**
 * Adds a person to a merchant's team (staff only). Creates their Cognito user
 * in the `merchant` group and emails a one-time link to choose a password —
 * the same claim flow payers use. A person belongs to one merchant only, and
 * team members and payers are different people, so an email already in use is
 * rejected. The link is never returned here: whoever sets the password is
 * whoever approves as this member.
 */
export default class InviteMerchantMemberHandler {
  async execute(event: Event, context: Context) {
    const staffUserId = event.requestContext?.authorizer?.userId
    // The body was checked against schemas/merchants/members/invite.json
    const { merchantId, email, name, roles } = event.body

    // Stricter than the schema's email format: no quotes or backslashes, as the address goes
    // into a Cognito ListUsers filter
    if (!EMAIL_RE.test(email)) return processError(100031, 'email')

    const merchant = await getMerchant(merchantId)
    if (!merchant.success) return processError(100003)
    if (merchant.res?.status !== 'active') return processError(100040)

    const identity = await this.createIdentity(email)
    if ('error' in identity) return identity.error
    const { userId } = identity

    const now = Date.now()
    const firstName = name.trim().split(/\s+/)[0]
    const claim = createClaimToken()

    const written = await transactWriteItems({
      puts: [
        {
          tableName: 'v2CustomerTable',
          item: { id: userId, sk: 'USERPROFILE', name: name.trim(), firstName, email, kind: 'MERCHANT_MEMBER', created_at: now, updated_at: now, deleted_at: null },
        },
        {
          tableName: 'v2CustomerTable',
          item: { id: claimRecordId(claim.tokenHash), sk: 'CLAIM', userId, email, expiresAt: claim.expiresAt, usedAt: null, created_at: now },
        },
        { tableName: 'v2CustomerTable', item: claimPointerItem(userId, claim.tokenHash) },
        {
          tableName: 'v1MerchantTable',
          item: { id: merchantId, sk: `MEMBER#${userId}`, userId, email, name: name.trim(), roles, status: 'active', invitedBy: staffUserId, createdAt: new Date(now).toISOString() },
          conditionExpression: 'attribute_not_exists(sk)',
        },
        {
          // One merchant per person: a second membership fails here
          tableName: 'v1MerchantTable',
          item: { id: `USER#${userId}`, sk: 'MEMBERSHIP', merchantId, createdAt: new Date(now).toISOString() },
          conditionExpression: 'attribute_not_exists(id)',
        },
      ],
    })
    if (!written.success) {
      console.error('MERCHANT_MEMBER: failed to persist the invite', written.error)
      return processError(100003)
    }

    const intro = `You were added to the ${merchant.res.name} team on ${brandName()}.`
    const emailSent = await sendClaimInvite(email, firstName, claim, intro)

    console.log(`MERCHANT_MEMBER: invited ${userId} to ${merchantId} as ${roles.join(', ')} by ${staffUserId}, emailSent=${emailSent}`)

    return response({
      statusCode: 201,
      headers: null,
      bodyObject: { success: true, merchantId, userId, roles, emailSent },
    })
  }

  /**
   * An email already in Cognito with a profile belongs to someone else. One
   * without a profile is an orphan from an invite that failed after
   * AdminCreateUser — adopt it so the person can still be invited.
   */
  private async createIdentity(email: string): Promise<{ error: any } | { userId: string }> {
    const existing = await findUserByEmail(email)

    if (existing?.sub) {
      const profile = await queryRecord('v2CustomerTable', 'id = :id AND sk = :sk', { ':id': existing.sub, ':sk': 'USERPROFILE' })
      if (profile.res?.length) return { error: processError(100032) }
      console.log(`MERCHANT_MEMBER: adopting orphaned Cognito user ${existing.sub}`)
      await addUserToGroup(existing.username, 'merchant')
      return { userId: existing.sub }
    }

    const { sub, username } = await adminCreateUser(email)
    await addUserToGroup(username, 'merchant')
    return { userId: sub }
  }
}
