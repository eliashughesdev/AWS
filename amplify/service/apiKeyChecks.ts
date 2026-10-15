import { processError } from '../errors/http'
import { publicRoutes } from './publicRoutes'

/**
 * What the router checks for a request let in with an API key (docs/public-api-plan.md D2.4),
 * before the route's roles and schema. The authorizer has checked who the key is and counted the
 * call (fn/authorizer/apiKey.js); these decide whether it may make this call now:
 *
 * 1. only on the public API: elsewhere the route does not exist for it (404)
 * 2. not over its rate limit this second: 429 100056, with Retry-After
 * 3. holding the route's permission ('any' passes; a route whose permission is null takes no
 *    key): 403 100055
 *
 * Every answer to a key carries X-RateLimit-Limit, -Remaining and -Reset.
 */

// The authorizer's context for an API key; every value is a string
export type ApiKeyAuthorizer = {
  authType?: string
  keyId?: string
  permissions?: string
  throttled?: string
  rateLimit?: string
  rateRemaining?: string
  rateReset?: string
}

type Answer = { statusCode: number, headers?: object | null, body: string }

export const isApiKey = (authorizer: ApiKeyAuthorizer | undefined): authorizer is ApiKeyAuthorizer =>
  authorizer?.authType === 'apikey'

// The permission a key needs for a route: a name, 'any', null for none, undefined off the list
export const routePermission = (path: string, method: string) => {
  const route = publicRoutes.find(r => r.path === path && r.method === method)
  return route?.auth === 'custom' ? route.permission : undefined
}

export const rateHeaders = (authorizer: ApiKeyAuthorizer): Record<string, string> => {
  const headers: Record<string, string> = {}
  if (authorizer.rateLimit) headers['X-RateLimit-Limit'] = authorizer.rateLimit
  if (authorizer.rateRemaining) headers['X-RateLimit-Remaining'] = authorizer.rateRemaining
  if (authorizer.rateReset) headers['X-RateLimit-Reset'] = authorizer.rateReset
  return headers
}

// An answer with the key's rate headers added to whatever headers it has
export const withRateHeaders = <T extends Answer>(answer: T, authorizer: ApiKeyAuthorizer): T => ({
  ...answer,
  headers: {
    ...(answer.headers ?? { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }),
    ...rateHeaders(authorizer),
    // A browser reading the answer cross-origin sees only the headers named here
    'Access-Control-Expose-Headers': 'Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
  },
})

/** The refusal for a key's request, or null when it may go on to the route. */
export const apiKeyRefusal = (
  authorizer: ApiKeyAuthorizer,
  route: { path: string, method: string },
  viaPublicApi: boolean,
  now = Date.now()
): Answer | null => {
  if (!viaPublicApi) {
    console.log(`DEBUG: API key ${authorizer.keyId} refused off the public API`)
    return { statusCode: 404, headers: null, body: JSON.stringify({ message: 'Not Found' }) }
  }

  if (authorizer.throttled === 'true') {
    const reset = Number(authorizer.rateReset)
    const retryAfter = Number.isFinite(reset) ? Math.max(1, Math.ceil(reset - now / 1000)) : 1
    console.log(`DEBUG: API key ${authorizer.keyId} over its rate limit`)
    const refused = withRateHeaders(processError(100056, undefined, 429), authorizer)
    return { ...refused, headers: { ...refused.headers, 'Retry-After': String(retryAfter) } }
  }

  const needed = routePermission(route.path, route.method)
  const held = (authorizer.permissions ?? '').split(',').filter(Boolean)
  if (needed === 'any') return null
  if (needed === undefined || needed === null || !held.includes(needed)) {
    console.log(`DEBUG: API key ${authorizer.keyId} lacks ${needed ?? 'a key permission'} for ${route.method} ${route.path}`)
    return withRateHeaders(processError(100055, needed ?? undefined, 403), authorizer)
  }
  return null
}
