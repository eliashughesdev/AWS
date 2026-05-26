import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { queryRecord } from '../../../utils/db'

export default class AccountsListHandler {
  async execute(event: any, context: Context) {
    const userId = event.requestContext?.authorizer?.userId

    if (!userId) {
      return response({
        statusCode: 401,
        headers: null,
        bodyObject: { message: 'User ID not found in authorization context' }
      })
    }

    const result = await queryRecord(
      'v2CustomerTable',
      'id = :id AND begins_with(sk, :prefix)',
      { ':id': userId, ':prefix': 'ACCOUNT#' }
    )

    if (!result.success) {
      return response({
        statusCode: 500,
        headers: null,
        bodyObject: { message: 'Failed to fetch accounts' }
      })
    }

    const accounts = (result.res ?? []).map((item: any) => ({
      accountNo: item.accountNo,
      chain: item.chain,
      depositAddress: item.depositAddress,
      currency: item.currency,
      status: item.status,
      createdAt: item.created_at,
    }))

    return response({
      statusCode: 200,
      headers: null,
      bodyObject: { accounts }
    })
  }
}
