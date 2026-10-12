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
