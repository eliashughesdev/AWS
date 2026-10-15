import { processError } from '../errors/http'

// What the authorizer (fn/authorizer/handler.js) puts on requestContext.authorizer
type Authorizer = { userId?: string, role?: string, authType?: string, merchantId?: string } | undefined
type Event = { requestContext?: { authorizer?: Authorizer } } | undefined

export type UserCaller =
  | { userId: string, error?: never }
  | { userId?: never, error: ReturnType<typeof processError> }

export type MerchantCaller =
  | { merchantId: string, error?: never }
  | { merchantId?: never, error: ReturnType<typeof processError> }

const refused = () => ({ error: processError(100053, undefined, 403) })

/**
 * The user a route acts on (docs/public-api-plan.md, step 1.1): whoever signed in with a Cognito
 * JWT, whatever their group, since staff and a merchant's team have accounts of their own. A
 * merchant's HMAC key is refused: its userId is the merchant id, so an account route would act
 * on a "user" whose id is the merchant's. Anything else (no context, an unknown authType) is
 * refused too, never taken as some user.
 */
export const callerUser = (event: Event): UserCaller => {
  const authorizer = event?.requestContext?.authorizer
  if (authorizer?.authType === 'jwt' && authorizer.userId) return { userId: authorizer.userId }
  return refused()
}

/**
 * The merchant a route acts for: the one whose HMAC key signed the request (X-Project). A
 * signed-in person is refused, the Cognito group admin included, whose role is 'admin' too.
 */
export const callerMerchant = (event: Event): MerchantCaller => {
  const authorizer = event?.requestContext?.authorizer
  if (authorizer?.authType === 'key' && authorizer.role === 'admin' && authorizer.merchantId) {
    return { merchantId: authorizer.merchantId }
  }
  return refused()
}
