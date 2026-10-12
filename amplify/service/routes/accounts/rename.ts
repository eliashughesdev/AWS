import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { updateItem } from '../../../utils/db'
import { processError } from '../../../errors/http'

export default class AccountsRenameHandler {
  async execute(event: any, context: Context) {
    const userId = event.requestContext?.authorizer?.userId

    if (!userId) {
      return response({ statusCode: 401, headers: null, bodyObject: { message: 'Unauthorized' } })
    }

    const name: string = event.body.name.trim()

    // Keyed on the caller: someone else's account is a miss, like one that does not exist
    const result = await updateItem({
      tableName: 'v2CustomerTable',
      key: { id: userId, sk: `ACCOUNT#${event.body.accountNumber}` },
      // An empty name leaves the account with none
      updateExpression: name ? 'SET #name = :name' : 'REMOVE #name',
      conditionExpression: 'attribute_exists(id)',
      attributeNames: { '#name': 'name' },
      attributeValues: name ? { ':name': name } : {},
    })

    if (!result.success) {
      return processError(result.error?.name === 'ConditionalCheckFailedException' ? 100001 : 100003)
    }

    return response({ statusCode: 200, headers: null, bodyObject: { success: true } })
  }
}
