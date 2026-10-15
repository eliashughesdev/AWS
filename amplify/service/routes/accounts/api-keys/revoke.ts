import { revokeKey, signedInOnly } from '../../../../utils/apiKeys'

type Event = {
  requestContext?: { authorizer?: { userId?: string, authType?: string } }
  body: { keyId: string }
}

/** Revokes one of the caller's own keys; again on a revoked one answers success (D2.6). */
export default class RevokeApiKeyHandler {
  async execute(event: Event) {
    const caller = signedInOnly(event.requestContext?.authorizer)
    if (caller.error) return caller.error
    return revokeKey({ keyId: event.body.keyId, revokedBy: caller.userId, ownerId: caller.userId })
  }
}
