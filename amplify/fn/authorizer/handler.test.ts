import crypto from 'crypto'

// A merchant's HMAC key as v1UserKeysTable holds it
const secretKey = crypto.randomBytes(32).toString('hex')
jest.mock('./db', () => ({
  getRecord: jest.fn(async () => ({ success: true, res: { id: 'merchant-1', type: 'hmac', key: secretKey } })),
}))

const { handler } = require('./handler')

// Regression: the authorizer logged each merchant's secret key, every Authorization header,
// the signatures it compared and the whole event
describe('authorizer logging', () => {
  let logged: string[]

  beforeEach(() => {
    logged = []
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg) ?? String(arg)).join(' '))
      })
    }
  })
  afterEach(() => jest.restoreAllMocks())

  const event = (authorization: string) => ({
    methodArn: 'arn:aws:execute-api:us-east-2:1:api/v1/POST/accounts/onboarding',
    headers: { Authorization: authorization, 'X-Project': 'merchant-1' },
    requestContext: { identity: { sourceIp: '203.0.113.7' }, path: '/v1/accounts/onboarding' },
  })

  const signed = (key: string) => {
    const timestamp = Date.now()
    const bodyHash = 'd41d8cd98f00b204e9800998ecf8427e'
    const signature = crypto.createHmac('sha256', Buffer.from(key, 'hex'))
      .update(`/v1/accounts/onboarding${timestamp}${bodyHash}`).digest('base64')
    return { authorization: `Signature ${timestamp}:${bodyHash}:${signature}`, signature }
  }

  const expectNotLogged = (...secrets: string[]) => {
    for (const secret of secrets) expect(logged.filter(line => line.includes(secret))).toEqual([])
  }

  it('allows a correctly signed request without logging the key or the signature', async () => {
    const { authorization, signature } = signed(secretKey)
    const policy = await handler(event(authorization))
    expect(policy.policyDocument.Statement[0].Effect).toBe('Allow')
    expectNotLogged(secretKey, signature, authorization)
  })

  it('denies a forged signature without logging the right one', async () => {
    const { authorization, signature } = signed(crypto.randomBytes(32).toString('hex'))
    const right = crypto.createHmac('sha256', Buffer.from(secretKey, 'hex'))
      .update(authorization.split(' ')[1].split(':').slice(0, 2).reduce((path, part) => path + part, '/v1/accounts/onboarding'))
      .digest('base64')
    const policy = await handler(event(authorization))
    expect(policy.policyDocument.Statement[0].Effect).toBe('Deny')
    expectNotLogged(secretKey, signature, right)
  })

  it('does not log a bearer token', async () => {
    const token = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.never-logged-signature'
    const policy = await handler(event(`Bearer ${token}`))
    expect(policy.policyDocument.Statement[0].Effect).toBe('Deny')
    expectNotLogged(token)
  })
})

// F3: role 'admin' is both a merchant's key and the Cognito group admin, so the API could not
// tell whether userId was a merchant id; the context now says which credential was checked
describe('authorizer context', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}))
  afterEach(() => jest.restoreAllMocks())

  const event = (authorization: string) => ({
    methodArn: 'arn:aws:execute-api:us-east-2:1:api/v1/GET/payments/list',
    headers: { Authorization: authorization, 'X-Project': 'merchant-1' },
    requestContext: { identity: { sourceIp: '203.0.113.7' }, path: '/v1/payments/list' },
  })

  it('names a merchant key as key, with the merchant it was verified for', async () => {
    const timestamp = Date.now()
    const bodyHash = 'd41d8cd98f00b204e9800998ecf8427e'
    const signature = crypto.createHmac('sha256', Buffer.from(secretKey, 'hex'))
      .update(`/v1/payments/list${timestamp}${bodyHash}`).digest('base64')
    const policy = await handler(event(`Signature ${timestamp}:${bodyHash}:${signature}`))
    expect(policy.context).toEqual({ userId: 'merchant-1', role: 'admin', authType: 'key', merchantId: 'merchant-1' })
  })

  describe('a Cognito token', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'kid-1', alg: 'RS256', use: 'sig' }
    const issuer = 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_pool'
    const token = (groups: string[]) => require('jsonwebtoken').sign(
      { sub: 'user-1', token_use: 'access', iss: issuer, auth_time: Math.floor(Date.now() / 1000) - 10, 'cognito:groups': groups },
      privateKey.export({ format: 'pem', type: 'pkcs8' }),
      { algorithm: 'RS256', keyid: 'kid-1', expiresIn: 300 })

    beforeEach(() => {
      process.env.AWS_REGION = 'us-east-2'
      process.env.COGNITO_USER_POOL_ID = 'us-east-2_pool'
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ keys: [jwk] }) } as any)
    })

    it('names a signed-in user as jwt, with no merchant', async () => {
      const policy = await handler(event(`Bearer ${token([])}`))
      expect(policy.policyDocument.Statement[0].Effect).toBe('Allow')
      expect(policy.context).toEqual({ userId: 'user-1', role: 'user', authType: 'jwt' })
    })

    it('names the Cognito group admin as jwt, so it is not taken for a merchant key', async () => {
      const policy = await handler(event(`Bearer ${token(['admin'])}`))
      expect(policy.context).toEqual({ userId: 'user-1', role: 'admin', authType: 'jwt' })
    })
  })
})
