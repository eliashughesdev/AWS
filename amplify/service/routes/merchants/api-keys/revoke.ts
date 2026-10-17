import { revokeKey, signedInOnly } from '../../../../utils/apiKeys'

type Event = {
  requestContext?: { authorizer?: { userId?: string, authType?: string } }
  body: { keyId: string, reason: string }
}

/** Staff revoke any key, users' or merchants', saying why; its owner is told the reason (D2.6). */
export default class StaffRevokeApiKeyHandler {
  async execute(event: Event) {
    const caller = signedInOnly(event.requestContext?.authorizer)
    if (caller.error) return caller.error
    return revokeKey({ keyId: event.body.keyId, revokedBy: caller.userId, reason: event.body.reason.trim() })
  }
}
