import { apiKeyRefusal, routePermission, withRateHeaders } from './apiKeyChecks'

jest.mock('./publicRoutes', () => ({
  publicRoutes: [
    { path: '/accounts/list', method: 'GET', auth: 'custom', permission: 'accounts:read' },
    { path: '/me', method: 'GET', auth: 'custom', permission: 'any' },
    { path: '/payments/save', method: 'POST', auth: 'custom', permission: null },
    { path: '/onboarding/claim', method: 'POST', auth: 'none' },
  ],
}))

// The context fn/authorizer/apiKey.js gives a key
const key = (extra: Record<string, string> = {}) => ({
  authType: 'apikey',
  keyId: 'lk_live_0123456789abcdef',
  permissions: 'accounts:read,withdrawals:create',
  throttled: 'false',
  rateLimit: '10',
  rateRemaining: '7',
  rateReset: '1792000001',
  ...extra,
})
const at = (path: string, method = 'GET') => ({ path, method })
const codeOf = (answer: { statusCode: number, body: string } | null) => answer && [answer.statusCode, JSON.parse(answer.body).error_code]

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}))
afterEach(() => jest.restoreAllMocks())

// docs/public-api-plan.md D2.4, step 2.5
describe('apiKeyRefusal', () => {
  it('lets a key holding the route\'s permission through', () => {
    expect(apiKeyRefusal(key(), at('/accounts/list'), true)).toBeNull()
  })

  it('answers 404 off the public API, whatever the key holds', () => {
    const res = apiKeyRefusal(key(), at('/accounts/list'), false)!
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toEqual({ message: 'Not Found' })
  })

  it('answers 429 100056 over the rate limit, saying when to retry', () => {
    const res = apiKeyRefusal(key({ throttled: 'true', rateRemaining: '0' }), at('/accounts/list'), true, 1_792_000_000_400)!
    expect(codeOf(res)).toEqual([429, 100056])
    expect(res.headers).toMatchObject({
      'Retry-After': '1',
      'X-RateLimit-Limit': '10',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': '1792000001',
      'Access-Control-Allow-Origin': '*',
    })
  })

  it('checks the rate before the permission: a throttled key learns nothing more', () => {
    expect(codeOf(apiKeyRefusal(key({ throttled: 'true', permissions: '' }), at('/accounts/list'), true))).toEqual([429, 100056])
  })

  it('answers 403 100055 naming the permission a key lacks', () => {
    const res = apiKeyRefusal(key({ permissions: 'withdrawals:create' }), at('/accounts/list'), true)!
    expect(codeOf(res)).toEqual([403, 100055])
    expect(JSON.parse(res.body).message).toBe('this API key does not have the accounts:read permission')
    expect(res.headers).toMatchObject({ 'X-RateLimit-Remaining': '7' })
  })

  it('does not take a permission that only starts like the one needed', () => {
    expect(codeOf(apiKeyRefusal(key({ permissions: 'accounts:read-all' }), at('/accounts/list'), true))).toEqual([403, 100055])
    expect(codeOf(apiKeyRefusal(key({ permissions: '' }), at('/accounts/list'), true))).toEqual([403, 100055])
  })

  it('lets any key call a route open to any key', () => {
    expect(apiKeyRefusal(key({ permissions: '' }), at('/me'), true)).toBeNull()
  })

  it('refuses every key on a route that takes none, and on one off the list', () => {
    const res = apiKeyRefusal(key(), at('/payments/save', 'POST'), true)!
    expect(codeOf(res)).toEqual([403, 100055])
    expect(JSON.parse(res.body).message).toBe('this endpoint cannot be called with an API key')
    expect(codeOf(apiKeyRefusal(key(), at('/onboarding/claim', 'POST'), true))).toEqual([403, 100055])
    expect(codeOf(apiKeyRefusal(key(), at('/merchants/list'), true))).toEqual([403, 100055])
  })
})

describe('routePermission', () => {
  it('answers a route\'s permission, null for none, undefined off the list or without a credential', () => {
    expect(routePermission('/accounts/list', 'GET')).toBe('accounts:read')
    expect(routePermission('/accounts/list', 'POST')).toBeUndefined()
    expect(routePermission('/payments/save', 'POST')).toBeNull()
    expect(routePermission('/onboarding/claim', 'POST')).toBeUndefined()
  })
})

describe('withRateHeaders', () => {
  it('adds the rate headers to the answer\'s own, and lets a browser read them', () => {
    const res = withRateHeaders({ statusCode: 200, headers: { 'Idempotent-Replayed': 'true' }, body: '{}' }, key())
    expect(res.headers).toEqual({
      'Idempotent-Replayed': 'true',
      'X-RateLimit-Limit': '10',
      'X-RateLimit-Remaining': '7',
      'X-RateLimit-Reset': '1792000001',
      'Access-Control-Expose-Headers': 'Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
    })
    expect(withRateHeaders({ statusCode: 200, headers: null, body: '{}' }, key()).headers).toMatchObject({ 'Access-Control-Allow-Origin': '*' })
  })
})
