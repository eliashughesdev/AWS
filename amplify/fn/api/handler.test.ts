import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { handler } from './handler'
import { routes } from '../../service/router'

jest.mock('../../utils/config', () => ({ loadConfig: jest.fn() }))
jest.mock('../../utils/db', () => ({ transactWriteItems: jest.fn(async () => ({ success: true, res: {} })) }))

// Regression: the API logged every request whole, so CloudWatch held each password set through
// a claim link, its one-time token and every caller's Authorization header
describe('API request logging', () => {
  const secrets = { password: 'Pa55-word-never-logged', token: 'claim-token-never-logged', authorization: 'Bearer jwt-never-logged' }
  let logged: string[]

  beforeEach(() => {
    logged = []
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '))
      })
    }
  })
  afterEach(() => jest.restoreAllMocks())

  const call = (body: unknown) => handler({
    path: '/v1/onboarding/claim',
    httpMethod: 'POST',
    headers: { Authorization: secrets.authorization },
    body: JSON.stringify(body),
    requestContext: { requestId: 'req-1' },
  } as any, {} as any, () => {})

  const expectNoSecretLogged = () => {
    for (const secret of Object.values(secrets)) {
      expect(logged.filter(line => line.includes(secret))).toEqual([])
    }
  }

  it('logs no body value or header of a request the handler runs', async () => {
    jest.spyOn(routes.get('/onboarding/claim')!.handler.prototype, 'execute')
      .mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' })
    await call({ token: secrets.token, password: secrets.password })
    expectNoSecretLogged()
    // What it does log: the route and the body's field names
    expect(logged.join('\n')).toContain('/v1/onboarding/claim')
    expect(logged.join('\n')).toContain('password')
  })

  // Regression: /payments/save logged the record it stored, card data included
  it('logs no card data of a card the handler saves', async () => {
    const cardData = 'ev:card-ciphertext-never-logged'
    const res = await handler({
      path: '/v1/payments/save',
      httpMethod: 'POST',
      headers: { Authorization: secrets.authorization },
      body: JSON.stringify({ userId: 'user-1', paymentMethod: { lastFour: '4242', bin: '42424242', cardType: 'visa', cardData } }),
      requestContext: { requestId: 'req-2', authorizer: { userId: 'user-1', role: 'user', authType: 'jwt' } },
    } as any, {} as any, () => {}) as { statusCode: number }
    expect(res.statusCode).toBe(200)
    expect(logged.filter(line => line.includes(cardData))).toEqual([])
    expectNoSecretLogged()
  })

  it('logs no body value of a request the schema refuses', async () => {
    await call({ token: secrets.token, password: secrets.password + 'x'.repeat(300) })
    expectNoSecretLogged()
  })
})

// A route handler that logs its event or body puts the same secrets back in CloudWatch
describe('route handlers', () => {
  const root = join(__dirname, '../../service/routes')
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.startsWith('e2e'))
  // Tatum's notifications: public chain data, kept for debugging deposits
  const allowed = ['webhook/cb.ts', 'webhook/tatum/accountTransactions.ts']

  it.each(files.filter(file => !allowed.includes(file)))('%s logs neither its event nor its body', file => {
    const source = readFileSync(join(root, file), 'utf8')
    expect(source).not.toMatch(/console\.\w+\([^)]*JSON\.stringify\(event(\.body)?\)/)
    expect(source).not.toMatch(/console\.\w+\([^)]*[\s,(]event(\.body)?\s*\)/)
  })
})
