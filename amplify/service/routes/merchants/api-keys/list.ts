import { response } from '../../../../utils/http'
import { processError } from '../../../../errors/http'
import { keyView, signedInOnly } from '../../../../utils/apiKeys'
import { API_KEYS_TABLE } from '../../../../utils/apiKeyStore'
import { scanItems } from '../../../../utils/db'

type Filters = { ownerId?: string, merchantId?: string, ownerType?: string, status?: string }
type Event = {
  requestContext?: { authorizer?: { userId?: string, authType?: string } }
  queryStringParameters?: Filters | null
}

/**
 * Every key, users' and merchants', newest first, narrowed by the filters in the query string
 * (staff; D2.6). The table is scanned, which is fine only while it is small.
 */
export default class ListAllApiKeysHandler {
  async execute(event: Event) {
    const caller = signedInOnly(event.requestContext?.authorizer)
    if (caller.error) return caller.error
    const filters = event.queryStringParameters ?? {}

    const scanned = await scanItems(API_KEYS_TABLE, 'begins_with(id, :prefix)', { ':prefix': 'lk_' })
    if (!scanned.success) return processError(100003)
    const keys = scanned.res!
      .filter(row => (Object.keys(filters) as (keyof Filters)[]).every(name => row[name] === filters[name]))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(keyView)
    return response({ statusCode: 200, headers: null, bodyObject: { success: true, keys } })
  }
}
