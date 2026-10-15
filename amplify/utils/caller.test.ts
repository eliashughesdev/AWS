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

// docs/public-api-plan.md step 2.5: API keys (fn/authorizer/apiKey.js)
describe('API keys', () => {
  const userKey = { userId: 'user-1', role: 'user', authType: 'apikey', ownerType: 'user', keyId: 'lk_live_1' }
  const merchantKey = { userId: 'merchant-1', role: 'admin', authType: 'apikey', ownerType: 'merchant', merchantId: 'merchant-1', keyId: 'lk_live_2' }

  it('takes a user\'s key as its user, and refuses a merchant\'s', () => {
    expect(callerUser(event(userKey))).toEqual({ userId: 'user-1' })
    expect(refusal(callerUser(event(merchantKey)))).toEqual([403, 100053])
  })

  it('takes a merchant\'s key as its merchant, and refuses a user\'s', () => {
    expect(callerMerchant(event(merchantKey))).toEqual({ merchantId: 'merchant-1' })
    expect(refusal(callerMerchant(event(userKey)))).toEqual([403, 100053])
  })

  it('refuses a key whose owner type is missing or does not fit the rest', () => {
    const { ownerType: _, ...noOwner } = userKey
    expect(refusal(callerUser(event(noOwner)))).toEqual([403, 100053])
    expect(refusal(callerMerchant(event({ ...merchantKey, role: 'user' })))).toEqual([403, 100053])
    expect(refusal(callerMerchant(event({ ...merchantKey, merchantId: '' })))).toEqual([403, 100053])
  })
})
