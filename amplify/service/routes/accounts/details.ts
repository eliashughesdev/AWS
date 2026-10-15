import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { getRecord, queryItemFromIndex } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { callerUser } from '../../../utils/caller'

export default class DetailsHandler {
  async execute(event: any, context: Context) {
    const caller = callerUser(event)
    if (caller.error) return caller.error

    const account = await queryItemFromIndex({
      tableName: 'v2CustomerTable',
      indexName: 'v1v2CustomerTableToAccountId',
      keyConditionExpression: '#sk = :accountNumber',
      attributeNames: {
        '#sk': 'sk',
      },
      attributeValues: {
        ':accountNumber': `ACCOUNT#${event.body.accountNumber}`,
      }
    })
    // Someone else's account is a miss, like one that does not exist: it read any account before
    const accountDet = account.success ? account.res?.[0] : undefined
    if (!accountDet || accountDet.id !== caller.userId) {
      console.error(`ERROR: Account not found for the caller: ${event.body.accountNumber}`)
      return processError(100001)
    }

    console.log('DEBUG: Retrieved Account Record:', JSON.stringify(account))

    // ignore Legacy non-custodial backend records 
    // tihs is test code to quickly test a few things but this will never happen
    if (!accountDet.vAccountId) {
      console.error(`ERROR: Account ${event.body.accountNumber} has no vAccountId`)
      return processError(100001)
    }

    const balanceKey = accountDet.vAccountId

    console.log('DEBUG: Balance lookup key:', balanceKey)

    const balanceResult = await getRecord('v1AccountBalanceTable', balanceKey)

    if (!balanceResult.success || !balanceResult.res) {
      console.error(`ERROR: Balance record not found for key: ${balanceKey}`)
      return processError(100008)
    }

    const balance = balanceResult.res
    console.log('DEBUG: Retrieved Balance Record:', JSON.stringify(balance))

    const res = { ...accountDet, ...balance }

    res.name = accountDet.name ?? accountDet.accountNo
    delete res.vAccountId
    delete res.providerId


    // const fees = await getRecord('v1FeesTable', account.res?.fees)
    // if (!fees.success || !fees.res) return processError(100007)

    // res.fees = { ...fees.res }

    // delete res.providerId

    return response({
      statusCode: 200,
      headers: null,
      bodyObject: {
        success: true,
        res: {
          data: { res }
        }
      }
    })
  }
}
