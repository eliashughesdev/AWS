import { response } from '../../../../utils/http'
import { permissionsFor, signedInOnly } from '../../../../utils/apiKeys'

type Event = { requestContext?: { authorizer?: { userId?: string, authType?: string } } }

/** The permissions a user's key may hold, for the key screens (docs/public-api-plan.md D2.6, D5). */
export default class ApiKeyPermissionsHandler {
  async execute(event: Event) {
    const caller = signedInOnly(event.requestContext?.authorizer)
    if (caller.error) return caller.error
    return response({ statusCode: 200, headers: null, bodyObject: { success: true, permissions: permissionsFor('user') } })
  }
}
