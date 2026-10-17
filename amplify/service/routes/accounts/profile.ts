import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { queryRecord } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { callerUser } from '../../../utils/caller'

export default class ProfileHandler {
  async execute(event: any, context: Context) {
    const caller = callerUser(event)
    if (caller.error) return caller.error
    const { userId } = caller

    const result = await queryRecord(
      'v2CustomerTable',
      'id = :id AND sk = :sk',
      { ':id': userId, ':sk': 'USERPROFILE' }
    )

    if (!result.success || !result.res?.length) {
      return processError(100001)
    }

    const profile = result.res[0]

    return response({
      statusCode: 200,
      headers: null,
      bodyObject: {
        name: profile.name ?? null,
        email: profile.email ?? null,
      }
    })
  }
}
