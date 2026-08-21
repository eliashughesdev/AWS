import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { queryRecord, getRecord } from '../../../utils/db'

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

    // ignore Legacy non-custodial backend records 
    // tihs is test code to quickly test a few things but this will never happen
    const accountRecords = (result.res ?? []).filter((item: any) => !!item.vAccountId)

    const balanceResults = await Promise.all(
      accountRecords.map((item: any) => getRecord('v1AccountBalanceTable', item.vAccountId))
    )

    const accounts = accountRecords.map((item: any, i: number) => {
      const bal = balanceResults[i].res
      return {
        accountNo: item.accountNo,
        chain: item.chain ?? null,
        depositAddress: item.depositAddress,
        currency: item.currency,
        status: item.status,
        createdAt: item.created_at,
        balance: bal?.balance ?? 0,
        availableBalance: bal?.availableBalance ?? 0,
      }
    })

    return response({
      statusCode: 200,
      headers: null,
      bodyObject: { accounts }
    })
  }
}
