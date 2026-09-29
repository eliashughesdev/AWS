import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { updateItem } from '../../../utils/db'
import { processError } from '../../../errors/http'

export default class ProfileSaveHandler {
  async execute(event: any, context: Context) {
    const userId = event.requestContext?.authorizer?.userId

    if (!userId) {
      return response({ statusCode: 401, headers: null, bodyObject: { message: 'Unauthorized' } })
    }

    const name: string | undefined = event.body?.name
    if (!name?.trim()) return processError(100029, 'name is required')

    // Update in place: the profile also carries merchantId, KYC and tier
    const email: string | undefined = event.body?.email
    const result = await updateItem({
      tableName: 'v2CustomerTable',
      key: { id: userId, sk: 'USERPROFILE' },
      updateExpression: `SET #name = :name, #updated = :now, #created = if_not_exists(#created, :now)${email ? ', #email = :email' : ''}`,
      attributeNames: {
        '#name': 'name',
        '#updated': 'updated_at',
        '#created': 'created_at',
        ...(email ? { '#email': 'email' } : {}),
      },
      attributeValues: { ':name': name.trim(), ':now': Date.now(), ':email': email },
    })

    if (!result.success) return processError(100003)

    return response({ statusCode: 200, headers: null, bodyObject: { success: true } })
  }
}
