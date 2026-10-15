import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { queryRecord } from '../../../utils/db'
import { callerUser } from '../../../utils/caller'

export default class KycStatusHandler {
  async execute(event: any, context: Context) {
    const caller = callerUser(event)
    if (caller.error) return caller.error
    const { userId } = caller

    const result = await queryRecord(
      'v2CustomerTable',
      'id = :id AND sk = :sk',
      { ':id': userId, ':sk': 'USERPROFILE' }
    )

    if (!result.success || !result.res?.[0]) {
      return response({
        statusCode: 404,
        headers: null,
        bodyObject: { message: 'User profile not found' }
      })
    }

    const kyc = result.res[0].kyc ?? null

    return response({
      statusCode: 200,
      headers: null,
      bodyObject: { kyc }
    })
  }
}
