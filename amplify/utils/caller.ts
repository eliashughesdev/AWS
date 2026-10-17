import { processError } from '../errors/http'

// What the authorizer (fn/authorizer/handler.js) puts on requestContext.authorizer
export type Authorizer = { userId?: string, role?: string, authType?: string, merchantId?: string, ownerType?: string } | undefined
type Event = { requestContext?: { authorizer?: Authorizer } } | undefined

export type UserCaller =
  | { userId: string, error?: never }
  | { userId?: never, error: ReturnType<typeof processError> }

export type MerchantCaller =
  | { merchantId: string, error?: never }
  | { merchantId?: never, error: ReturnType<typeof processError> }

const refused = () => ({ error: processError(100053, undefined, 403) })

// A signed-in person (JWT), or an API key of a user's (fn/authorizer/apiKey.js): userId is a user
export const isUserCredential = (authorizer: Authorizer) =>
  !!authorizer?.userId && (authorizer.authType === 'jwt' || (authorizer.authType === 'apikey' && authorizer.ownerType === 'user'))

// A merchant's HMAC key, or an API key of a merchant's: merchantId is the merchant it acts for
export const isMerchantCredential = (authorizer: Authorizer) =>
  !!authorizer?.merchantId && authorizer.role === 'admin' &&
    (authorizer.authType === 'key' || (authorizer.authType === 'apikey' && authorizer.ownerType === 'merchant'))

/**
 * The user a route acts on (docs/public-api-plan.md, steps 1.1 and 2.5): whoever signed in with a
 * Cognito JWT, whatever their group, since staff and a merchant's team have accounts of their own,
 * or a user's own API key. A merchant's key, HMAC or API, is refused: its userId is the merchant
 * id, so an account route would act on a "user" whose id is the merchant's. Anything else (no
 * context, an unknown authType) is refused too, never taken as some user.
 */
export const callerUser = (event: Event): UserCaller => {
  const authorizer = event?.requestContext?.authorizer
  if (isUserCredential(authorizer)) return { userId: authorizer!.userId! }
  return refused()
}

/**
 * The merchant a route acts for: the one whose HMAC key signed the request (X-Project), or whose
 * API key was sent. A signed-in person is refused, the Cognito group admin included, whose role
 * is 'admin' too, and so is a user's API key.
 */
export const callerMerchant = (event: Event): MerchantCaller => {
  const authorizer = event?.requestContext?.authorizer
  if (isMerchantCredential(authorizer)) return { merchantId: authorizer!.merchantId! }
  return refused()
}
