import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { getRecord, queryItemFromIndex } from '../../../utils/db'
import { processError } from '../../../errors/http'

export default class DetailsHandler {
  async execute(event: any, context: Context) {
    // todo ensure that customer have enough right to get this account
    // const cstomer = await getRecord('v2CustomerTable', event.body.account_id)
    // const account = await byindes('v2CustomerTable', event.body.account_id)
    const account = await queryItemFromIndex({
      tableName: 'v2CustomerTable',
      indexName: 'v1v2CustomerTableToAccountId',
      keyConditionExpression: '#sk = :accountNumber',
      attributeNames: {
        '#sk': 'sk',
      },
      attributeValues: {
        ':accountNumber': event.body.account_id,
      }
    })
    if (!account.success || !account.res) {
      console.error(`ERROR: Account not found for accountNo: ${event.body.account_id}`)
      return processError(100001)
    }


    const accountDet = account.res[0]
    const vAccountId = accountDet.vAccountId

    console.log('DEBUG: Retrieved Account Record:', JSON.stringify(account))
    console.log('DEBUG: Extracted vAccountId for balance lookup:', vAccountId)

    const balanceResult = await getRecord('v1AccountBalanceTable', vAccountId)

    if (!balanceResult.success || !balanceResult.res) {
      console.error(`ERROR: Balance record not found for vAccountId: ${vAccountId}`)
      return processError(100008) // Balance Not Found Error Code
    }

    const balance = balanceResult.res
    console.log('DEBUG: Retrieved Balance Record:', JSON.stringify(balance))

    const res = { ...accountDet, ...balance }

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
