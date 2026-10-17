import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { queryItemFromIndex, queryRecord } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { callerUser } from '../../../utils/caller'

export default class TransactionsHandler {
  async execute(event: any, context: Context) {
    const caller = callerUser(event)
    if (caller.error) return caller.error
    const { userId } = caller
    // Shaped as an account number (schemas/accounts/transactions.json)
    const accountNumber: string = event.body.accountNumber

    const accountResult = await queryItemFromIndex({
      tableName: 'v2CustomerTable',
      indexName: 'v1v2CustomerTableToAccountId',
      keyConditionExpression: '#sk = :accountNumber',
      attributeNames: { '#sk': 'sk' },
      attributeValues: { ':accountNumber': `ACCOUNT#${accountNumber}` },
    })

    if (!accountResult.success || !accountResult.res?.length) {
      return processError(100001)
    }

    const account = accountResult.res[0]
    if (account.id !== userId) {
      return response({ statusCode: 403, headers: null, bodyObject: { message: 'Forbidden' } })
    }


    // ignore Legacy non-custodial backend records 
    // tihs is test code to quickly test a few things but this will never happen
    if (!account.vAccountId) {
      return processError(100001)
    }
    const txKey = account.vAccountId

    const txResult = await queryRecord(
      'v1TransactionLogsTable',
      'id = :txKey AND begins_with(sk, :prefix)',
      { ':txKey': txKey, ':prefix': 'TX#' }
    )

    if (!txResult.success) {
      return response({ statusCode: 500, headers: null, bodyObject: { message: 'Failed to fetch transactions' } })
    }

    const transactions = (txResult.res ?? [])
      .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))
      .map((tx: any) => ({
        txId: tx.txId,
        type: tx.type,
        amount: tx.amount,
        currency: tx.currency,
        from: tx.from,
        to: tx.to,
        blockHeight: tx.blockHeight,
        blockHash: tx.blockHash,
        reference: tx.reference,
        createdAt: tx.createdAt,
      }))

    return response({
      statusCode: 200,
      headers: null,
      bodyObject: { transactions },
    })
  }
}
