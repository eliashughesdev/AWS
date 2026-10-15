import { response } from '../../../../utils/http'
import { processError } from '../../../../errors/http'
import { keysOf, keyView, signedInOnly } from '../../../../utils/apiKeys'

type Event = { requestContext?: { authorizer?: { userId?: string, authType?: string } } }

/** The caller's own keys, newest first, revoked ones too; never a secret or hash (D2.6). */
export default class ListApiKeysHandler {
  async execute(event: Event) {
    const caller = signedInOnly(event.requestContext?.authorizer)
    if (caller.error) return caller.error

    const keys = await keysOf(caller.userId)
    if (!keys) return processError(100003)
    return response({
      statusCode: 200,
      headers: null,
      bodyObject: { success: true, keys: keys.map(keyView).reverse() },
    })
  }
}
