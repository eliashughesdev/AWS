import { callerMerchant, callerUser } from './caller'

const event = (authorizer?: Record<string, string>) => ({ requestContext: { authorizer } })

// The contexts fn/authorizer/handler.js gives
const jwt = (role = 'user') => ({ userId: 'sub-1', role, authType: 'jwt' })
const hmac = { userId: 'merchant-1', role: 'admin', authType: 'key', merchantId: 'merchant-1' }

const refusal = (result: { error?: { statusCode: number, body: string } }) =>
  [result.error?.statusCode, JSON.parse(result.error?.body ?? '{}').error_code]

describe('callerUser', () => {
  it('answers the signed-in person, whatever their group', () => {
    for (const role of ['user', 'staff', 'admin', 'merchant']) {
      expect(callerUser(event(jwt(role)))).toEqual({ userId: 'sub-1' })
    }
  })

  // The bug in docs/public-api-plan.md D0.1: an HMAC key's userId is the merchant id, which
  // account routes took as a user
  it('refuses a merchant\'s HMAC key with 100053', () => {
    expect(refusal(callerUser(event(hmac)))).toEqual([403, 100053])
  })

  it('refuses a request with no context, no user id or an unknown authType', () => {
    expect(refusal(callerUser(event()))).toEqual([403, 100053])
    expect(refusal(callerUser(undefined))).toEqual([403, 100053])
    expect(refusal(callerUser(event({ role: 'user', authType: 'jwt' })))).toEqual([403, 100053])
    expect(refusal(callerUser(event({ userId: 'sub-1', role: 'user' })))).toEqual([403, 100053])
    expect(refusal(callerUser(event({ userId: 'sub-1', role: 'user', authType: 'none' })))).toEqual([403, 100053])
  })
})

describe('callerMerchant', () => {
  it('answers the merchant whose HMAC key signed the request', () => {
    expect(callerMerchant(event(hmac))).toEqual({ merchantId: 'merchant-1' })
  })

  it('refuses a signed-in person, the Cognito group admin included', () => {
    expect(refusal(callerMerchant(event(jwt('admin'))))).toEqual([403, 100053])
    expect(refusal(callerMerchant(event(jwt())))).toEqual([403, 100053])
  })

  it('refuses a key context that names no merchant', () => {
    expect(refusal(callerMerchant(event({ userId: 'merchant-1', role: 'admin', authType: 'key' })))).toEqual([403, 100053])
    expect(refusal(callerMerchant(event()))).toEqual([403, 100053])
  })
})
