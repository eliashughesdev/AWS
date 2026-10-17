import type { Context } from 'aws-lambda'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { deleteItem, putItem } from '../../../utils/db'
import { disableUser } from '../../../utils/cognito'
import { getMember } from '../../../utils/merchant'

type Event = {
  requestContext?: { authorizer?: { userId?: string } }
  body: { merchantId: string, userId: string }
}

/**
 * Removes a person from a merchant's team (staff only). The MEMBERSHIP row goes
 * first — every operation looks the caller's merchant up through it, so access
 * ends immediately, before their current Cognito tokens expire. Safe to retry.
 */
export default class RemoveMerchantMemberHandler {
  async execute(event: Event, context: Context) {
    const staffUserId = event.requestContext?.authorizer?.userId
    const { merchantId, userId } = event.body

    const member = await getMember(merchantId, userId)
    if (!member.success) return processError(100003)
    if (member.res?.status !== 'active') return processError(100049)

    const unlinked = await deleteItem('v1MerchantTable', { id: `USER#${userId}`, sk: 'MEMBERSHIP' })
    if (!unlinked.success) return processError(100003)

    const updated = await putItem('v1MerchantTable', {
      ...member.res,
      status: 'removed',
      removedBy: staffUserId,
      removedAt: new Date().toISOString(),
    })
    if (!updated.success) return processError(100003)

    // In this pool the Cognito username is the sub
    try {
      await disableUser(userId)
    } catch (err) {
      console.error(`MERCHANT_MEMBER: removed ${userId} from ${merchantId} but could not disable the Cognito user`, err)
    }

    console.log(`MERCHANT_MEMBER: removed ${userId} from ${merchantId} by ${staffUserId}`)

    return response({
      statusCode: 200,
      headers: null,
      bodyObject: { success: true, merchantId, userId, status: 'removed' },
    })
  }
}
