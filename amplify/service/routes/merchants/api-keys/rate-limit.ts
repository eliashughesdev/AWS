import { response } from '../../../../utils/http'
import { processError } from '../../../../errors/http'
import { isUsable, keysOf, signedInOnly } from '../../../../utils/apiKeys'
import { API_KEYS_TABLE } from '../../../../utils/apiKeyStore'
import { updateItem } from '../../../../utils/db'

type Event = {
  requestContext?: { authorizer?: { userId?: string, authType?: string } }
  body: { keyId?: string, userId?: string, perSecond: number }
}

/**
 * Staff set a key's calls per second, or those of every usable key one owner has (D2.5, D2.6).
 * The authorizer reads the limit from the row on each call, so it applies at once.
 */
export default class SetApiKeyRateLimitHandler {
  async execute(event: Event) {
    const caller = signedInOnly(event.requestContext?.authorizer)
    if (caller.error) return caller.error
    const { keyId, userId, perSecond } = event.body

    let keyIds: string[]
    if (keyId) {
      keyIds = [keyId]
    } else {
      const keys = await keysOf(userId!)
      if (!keys) return processError(100003)
      keyIds = keys.filter(row => isUsable(row)).map(row => row.id)
      if (keyIds.length === 0) return processError(100060, undefined, 404)
    }

    const changed: string[] = []
    for (const id of keyIds) {
      const updated = await updateItem({
        tableName: API_KEYS_TABLE,
        key: { id },
        updateExpression: 'SET rateLimit = :rate, updatedAt = :now',
        conditionExpression: 'attribute_exists(id)',
        attributeNames: undefined,
        attributeValues: { ':rate': { perSecond }, ':now': new Date().toISOString() },
      })
      if (updated.success) {
        changed.push(id)
      } else if (updated.error?.name === 'ConditionalCheckFailedException') {
        return processError(100060, undefined, 404)
      } else {
        console.error(`ERROR: The rate limit of ${id} could not be set`)
        return processError(100003)
      }
    }
    console.log(`API_KEY: ${changed.join(', ')} set to ${perSecond}/s by ${caller.userId}`)
    return response({ statusCode: 200, headers: null, bodyObject: { success: true, keyIds: changed, rateLimit: { perSecond } } })
  }
}
