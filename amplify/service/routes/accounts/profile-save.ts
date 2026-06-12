import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { putItem } from '../../../utils/db'
import { processError } from '../../../errors/http'

export default class ProfileSaveHandler {
  async execute(event: any, context: Context) {
    const userId = event.requestContext?.authorizer?.userId

    if (!userId) {
      return response({ statusCode: 401, headers: null, bodyObject: { message: 'Unauthorized' } })
    }

    const name: string | undefined = event.body?.name
    if (!name?.trim()) return processError(100029, 'name is required')

    const result = await putItem('v2CustomerTable', {
      id: userId,
      sk: 'USERPROFILE',
      name: name.trim(),
      email: event.body?.email ?? null,
      created_at: Date.now(),
      updated_at: Date.now(),
    })

    if (!result.success) return processError(100003)

    return response({ statusCode: 200, headers: null, bodyObject: { success: true } })
  }
}
