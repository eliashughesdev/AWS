import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { queryRecord, getRecord } from '../../../utils/db'
import { callerUser } from '../../../utils/caller'
import { kycSwitchesFor, readKycPolicy } from '../../../utils/kycPolicy'

export default class AccountsListHandler {
  async execute(event: any, context: Context) {
    const caller = callerUser(event)
    if (caller.error) return caller.error
    const { userId } = caller

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

    // Each account's merchant's KYC policy (docs/public-api-plan.md D11), read once per merchant:
    // a user's accounts nearly always share one. One that cannot be read shows KYC as required,
    // which is what an unset switch means; the money route decides either way
    const merchantIds = [...new Set(accountRecords.map((item: any) => item.merchantId as string | undefined))]
    const policies = new Map(await Promise.all(merchantIds.map(async id =>
      [id, await readKycPolicy(id).catch(() => null)] as const)))

    const accounts = accountRecords.map((item: any, i: number) => {
      const bal = balanceResults[i].res
      return {
        accountNo: item.accountNo,
        name: item.name ?? item.accountNo,
        chain: item.chain ?? null,
        depositAddress: item.depositAddress,
        currency: item.currency,
        status: item.status,
        createdAt: item.created_at,
        balance: bal?.balance ?? 0,
        availableBalance: bal?.availableBalance ?? 0,
        // Which money operations need the user's KYC approved in this account's currency
        kycRequired: kycSwitchesFor(policies.get(item.merchantId) ?? null, item.chain ?? item.currency ?? ''),
      }
    })

    return response({
      statusCode: 200,
      headers: null,
      bodyObject: { accounts }
    })
  }
}
