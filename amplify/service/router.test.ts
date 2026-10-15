import { findRoute, routeAt, router, routes } from './router'
import { publicRoutes } from './publicRoutes'
import { isTemplate, placeholdersOf } from './routeMatch'

const post = (path: string, body: unknown) =>
  router({ path, httpMethod: 'POST', body: JSON.stringify(body) }, {})

// Replaces a route's handler so no test reaches AWS, Tatum or DynamoDB
const stubHandler = (path: string) => {
  const execute = jest.spyOn(routeAt(path)!.handler.prototype, 'execute')
    .mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' })
  return execute
}

describe('router body validation', () => {
  afterEach(() => jest.restoreAllMocks())

  describe('a route with a schema', () => {
    it('runs the handler when the body matches', async () => {
      const execute = stubHandler('/accounts/details')
      const res = await post('/v1/accounts/details', { accountNumber: 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4' })
      expect(res.statusCode).toBe(200)
      expect(execute).toHaveBeenCalledTimes(1)
    })

    it('answers 100029 without running the handler when a field is missing', async () => {
      const execute = stubHandler('/accounts/account')
      const res = await post('/accounts/account', { account_name: 'Savings' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.body).error_code).toBe(100029)
      expect(execute).not.toHaveBeenCalled()
    })

    it('answers 100031 without running the handler when a value is wrong', async () => {
      const execute = stubHandler('/accounts/details')
      const res = await post('/accounts/details', { accountNumber: 'ACCOUNT#PCF00018604bbd641df4bb0aa5243e1e78f5cc4' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.body)).toMatchObject({ error_code: 100031, message: 'invalid value for accountNumber' })
      expect(execute).not.toHaveBeenCalled()
    })
  })

  describe('a route with a schema and allowed roles', () => {
    const onboarding = (body: unknown, role: string) =>
      router({ path: '/accounts/onboarding', httpMethod: 'POST', body: JSON.stringify(body), requestContext: { authorizer: { role } } } as any, {})

    it('refuses the wrong role before looking at the body', async () => {
      const execute = stubHandler('/accounts/onboarding')
      const res = await onboarding({}, 'user')
      expect(res.statusCode).toBe(403)
      expect(execute).not.toHaveBeenCalled()
    })

    it('answers 100029 for a missing nested field without running the handler', async () => {
      const execute = stubHandler('/accounts/onboarding')
      const body = { externalId: 'e', firstName: 'J', lastName: 'P', email: 'j@example.com', chain: 'TRON', transaction: { id: 't', currency: 'EUR' } }
      const res = await onboarding(body, 'admin')
      expect(JSON.parse(res.body)).toMatchObject({ error_code: 100029, message: 'required parameters for this request are transaction.id,transaction.amount,transaction.currency' })
      expect(execute).not.toHaveBeenCalled()
    })

    // docs/public-api-plan.md D11: only staff switch a merchant's KYC policy
    describe('/merchants/policy/kyc', () => {
      const setPolicy = (role: string) =>
        router({ path: '/merchants/policy/kyc', httpMethod: 'POST', body: JSON.stringify({ merchantId: 'internal-001', currency: 'SOL', withdraw: false }), requestContext: { authorizer: { role } } } as any, {})

      it('runs for staff', async () => {
        const execute = stubHandler('/merchants/policy/kyc')
        expect((await setPolicy('staff')).statusCode).toBe(200)
        expect(execute).toHaveBeenCalledTimes(1)
      })

      it.each(['user', 'admin', 'merchant'])('refuses %s', async role => {
        const execute = stubHandler('/merchants/policy/kyc')
        expect((await setPolicy(role)).statusCode).toBe(403)
        expect(execute).not.toHaveBeenCalled()
      })
    })

    // It had no allowedRoles: any caller the authorizer let through could send images to Didit
    describe('/accounts/kyc/didit/id-verify', () => {
      const idVerify = (role: string) =>
        router({ path: '/accounts/kyc/didit/id-verify', httpMethod: 'POST', body: JSON.stringify({ front_image: 'aGVsbG8=' }), requestContext: { authorizer: { role } } } as any, {})

      it.each(['user', 'staff'])('runs for %s', async role => {
        const execute = stubHandler('/accounts/kyc/didit/id-verify')
        expect((await idVerify(role)).statusCode).toBe(200)
        expect(execute).toHaveBeenCalledTimes(1)
      })

      // admin is a merchant's key (or the Cognito group admin); merchant a merchant's team member
      it.each(['admin', 'merchant'])('refuses %s', async role => {
        const execute = stubHandler('/accounts/kyc/didit/id-verify')
        expect((await idVerify(role)).statusCode).toBe(403)
        expect(execute).not.toHaveBeenCalled()
      })
    })
  })

  describe('a GET route with a schema', () => {
    const get = (path: string, query: Record<string, string> | null, role = 'user') =>
      router({ path, httpMethod: 'GET', body: null, queryStringParameters: query, requestContext: { authorizer: { role } } } as any, {})

    it('checks the query string and runs the handler when it matches', async () => {
      const execute = stubHandler('/payments/list')
      const res = await get('/v1/payments/list', { userId: 'user-1' })
      expect(res.statusCode).toBe(200)
      expect(execute).toHaveBeenCalledTimes(1)
    })

    // A GET with no query string has queryStringParameters null, checked as no parameters
    it('runs the handler when there is no query string', async () => {
      const execute = stubHandler('/payments/list')
      const res = await get('/payments/list', null)
      expect(res.statusCode).toBe(200)
      expect(execute).toHaveBeenCalledTimes(1)
    })

    // F3: only a user or a merchant's key may reach the card routes
    it('refuses a staff caller before looking at the query string', async () => {
      const execute = stubHandler('/payments/list')
      const res = await get('/payments/list', { userId: 'user-1' }, 'staff')
      expect(res.statusCode).toBe(403)
      expect(execute).not.toHaveBeenCalled()
    })

    it('answers 100031 without running the handler when a value is wrong', async () => {
      const execute = stubHandler('/payments/list')
      const res = await get('/payments/list', { userId: '' })
      expect(JSON.parse(res.body)).toMatchObject({ error_code: 100031, message: 'invalid value for userId' })
      expect(execute).not.toHaveBeenCalled()
    })

    // It answers every merchant, so only Loudibly's own staff may call it
    describe('/merchants/list', () => {
      it('runs for staff', async () => {
        const execute = stubHandler('/merchants/list')
        expect((await get('/merchants/list', null, 'staff')).statusCode).toBe(200)
        expect(execute).toHaveBeenCalledTimes(1)
      })

      it.each(['admin', 'merchant', 'user', undefined])('refuses %s', async role => {
        const execute = stubHandler('/merchants/list')
        expect((await get('/merchants/list', null, role)).statusCode).toBe(403)
        expect(execute).not.toHaveBeenCalled()
      })

      it('is not on the public API', async () => {
        const execute = stubHandler('/merchants/list')
        const res = await router({ path: '/v1/merchants/list', httpMethod: 'GET', body: null, stageVariables: { API_SURFACE: 'public' }, requestContext: { authorizer: { role: 'staff' } } } as any, {})
        expect(res.statusCode).toBe(404)
        expect(execute).not.toHaveBeenCalled()
      })
    })
  })

  describe('a route with requiredParams', () => {
    it('still answers 100029 when one is missing', async () => {
      const execute = stubHandler('/accounts/transactions')
      const res = await post('/accounts/transactions', {})
      expect(JSON.parse(res.body).error_code).toBe(100029)
      expect(execute).not.toHaveBeenCalled()
    })
  })
})

describe('router on the public API', () => {
  afterEach(() => jest.restoreAllMocks())

  const accountNumber = 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4'
  const publicPost = (path: string, body: unknown) =>
    router({ path, httpMethod: 'POST', body: JSON.stringify(body), stageVariables: { API_SURFACE: 'public' } }, {})

  it('runs a route that is in publicRoutes', async () => {
    const execute = stubHandler('/accounts/rename')
    const res = await publicPost('/v1/accounts/rename', { accountNumber, name: 'Savings' })
    expect(res.statusCode).toBe(200)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('answers 404 for a route that is not', async () => {
    const execute = stubHandler('/accounts/details')
    const res = await publicPost('/v1/accounts/details', { accountNumber })
    expect(res.statusCode).toBe(404)
    expect(execute).not.toHaveBeenCalled()
  })
})

// docs/public-api-plan.md step 1.3: paths with {placeholders}, and several methods on one path
describe('path templates', () => {
  const accountNo = /^PCF[0-9]{4}[0-9a-f]{32}$/
  const account = 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4'
  const seen: any[] = []
  class Handler { async execute(event: any) { seen.push(event); return { statusCode: 200, headers: {}, body: JSON.stringify({ handler: this.constructor.name }) } } }
  class ReadAccount extends Handler {}
  class RenameAccount extends Handler {}
  class Cancel extends Handler {}
  class Wildcard extends Handler {}

  const temporary: [string, any][] = [
    ['GET /accounts/{id}', { path: '/accounts/{id}', method: 'GET', handler: ReadAccount, requiredParams: [], params: { id: accountNo } }],
    ['PATCH /accounts/{id}', { path: '/accounts/{id}', method: 'PATCH', handler: RenameAccount, requiredParams: [], params: { id: accountNo } }],
    ['POST /withdrawals/{id}/cancel', { path: '/withdrawals/{id}/cancel', method: 'POST', handler: Cancel, requiredParams: [], params: { id: /^wdr_\w+$/ } }],
    ['POST /withdrawals/{id}/{action}', { path: '/withdrawals/{id}/{action}', method: 'POST', handler: Wildcard, requiredParams: [], params: { id: /^wdr_\w+$/, action: /^\w+$/ } }],
  ]

  beforeAll(() => { for (const [key, route] of temporary) routes.set(key, route) })
  afterAll(() => { for (const [key] of temporary) routes.delete(key) })
  beforeEach(() => { seen.length = 0 })

  const call = (httpMethod: string, path: string, extra: Record<string, unknown> = {}) =>
    router({ path, httpMethod, body: httpMethod === 'GET' ? null : '{}', requestContext: { authorizer: { role: 'user' } }, ...extra } as any, {})
  const handlerOf = async (res: Promise<{ statusCode: number, body: string }>) => {
    const r = await res
    return r.statusCode === 200 ? JSON.parse(r.body).handler : r.statusCode
  }

  it('runs the route of the method, with the placeholder\'s value as pathParameters', async () => {
    expect(await handlerOf(call('GET', `/v1/accounts/${account}`))).toBe('ReadAccount')
    expect(seen[0].pathParameters).toEqual({ id: account })
    expect(await handlerOf(call('PATCH', `/accounts/${account}`))).toBe('RenameAccount')
  })

  it('replaces API Gateway\'s own pathParameters ({ proxy } on the internal API)', async () => {
    await call('GET', `/accounts/${account}`, { pathParameters: { proxy: `accounts/${account}` } })
    expect(seen[0].pathParameters).toEqual({ id: account })
  })

  it('keeps a path written as it is ahead of a template', async () => {
    const execute = stubHandler('/accounts/list')
    const res = await call('GET', '/accounts/list')
    expect(res.statusCode).toBe(200)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(0)
  })

  it('answers 405 for a method the path does not have, a fixed path included', async () => {
    expect(await handlerOf(call('DELETE', `/accounts/${account}`))).toBe(405)
    // POST /accounts/list is not taken as /accounts/{id}
    expect(await handlerOf(call('POST', '/accounts/list'))).toBe(405)
  })

  it('prefers the template with fewer placeholders', async () => {
    expect(await handlerOf(call('POST', '/withdrawals/wdr_1/cancel'))).toBe('Cancel')
    expect(await handlerOf(call('POST', '/withdrawals/wdr_1/commit'))).toBe('Wildcard')
  })

  it('answers 100031 naming a value its pattern refuses, without running the handler', async () => {
    const res = await call('GET', '/accounts/not-an-account')
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toMatchObject({ error_code: 100031 })
    expect(JSON.parse(res.body).message).toContain('id')
    expect(seen).toHaveLength(0)
  })

  it('answers 404 for a path no route fits', async () => {
    expect(await handlerOf(call('GET', `/accounts/${account}/nothing`))).toBe(404)
    expect(await handlerOf(call('GET', '/accounts/'))).toBe(404)
  })

  it('is public by its template on the public API', async () => {
    const viaPublic = (path: string) => call('GET', path, { stageVariables: { API_SURFACE: 'public' } })
    expect(await handlerOf(viaPublic(`/accounts/${account}`))).toBe(404)

    publicRoutes.push({ path: '/accounts/{id}', method: 'GET', auth: 'custom', permission: 'accounts:read' })
    try {
      expect(await handlerOf(viaPublic(`/accounts/${account}`))).toBe('ReadAccount')
    } finally {
      publicRoutes.pop()
    }
  })

  it('finds a route without running it', () => {
    expect(findRoute(`/accounts/${account}`, 'GET')).toMatchObject({ route: { path: '/accounts/{id}' }, params: { id: account } })
    expect(findRoute(`/accounts/${account}`, 'POST')).toEqual({ allowed: ['GET', 'PATCH'] })
    expect(findRoute('/nowhere', 'GET')).toBeUndefined()
  })
})

describe('registered routes', () => {
  // A placeholder with no pattern would refuse every value it is sent (100031)
  it('give every placeholder of a template a pattern', () => {
    for (const route of routes.values()) {
      if (!isTemplate(route.path)) continue
      for (const name of placeholdersOf(route.path)) expect([route.path, name, route.params?.[name]]).toEqual([route.path, name, expect.any(RegExp)])
    }
  })

  it('register each method of a path once', () => {
    for (const [key, route] of routes) expect(key).toBe(`${route.method} ${route.path}`)
  })
})

// docs/public-api-plan.md D2.4, step 2.5: what the router checks for an API key, before roles and
// schema, and the rate headers on every answer to one
describe('router with an API key', () => {
  const apiKey = (extra: Record<string, string> = {}) => ({
    userId: 'user-1',
    role: 'user',
    authType: 'apikey',
    ownerType: 'user',
    keyId: 'lk_live_0123456789abcdef',
    permissions: 'accounts:read',
    throttled: 'false',
    rateLimit: '10',
    rateRemaining: '9',
    rateReset: '1792000001',
    ...extra,
  })
  const list = (authorizer: Record<string, string>, stageVariables: Record<string, string> | null = { API_SURFACE: 'public' }) =>
    router({ path: '/v1/accounts/list', httpMethod: 'GET', body: null, stageVariables, requestContext: { authorizer } } as any, {})

  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}))
  afterEach(() => jest.restoreAllMocks())

  it('runs the route for a key with its permission, adding the rate headers', async () => {
    const execute = stubHandler('/accounts/list')
    const res = await list(apiKey())
    expect(res.statusCode).toBe(200)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(res.headers).toMatchObject({ 'X-RateLimit-Limit': '10', 'X-RateLimit-Remaining': '9' })
  })

  it.each([
    ['off the public API', apiKey(), null, 404, undefined],
    ['over its rate limit', apiKey({ throttled: 'true' }), undefined, 429, 100056],
    ['without the permission', apiKey({ permissions: 'withdrawals:create' }), undefined, 403, 100055],
  ])('refuses a key %s, running nothing', async (_, authorizer, stage, status, code) => {
    const execute = stubHandler('/accounts/list')
    const res = await list(authorizer, stage === undefined ? { API_SURFACE: 'public' } : stage)
    expect(res.statusCode).toBe(status)
    if (code) expect(JSON.parse(res.body).error_code).toBe(code)
    expect(execute).not.toHaveBeenCalled()
  })

  it('refuses a key on a staff route as not found, as for anyone on the public API', async () => {
    const res = await router({ path: '/v1/merchants/list', httpMethod: 'GET', body: null, stageVariables: { API_SURFACE: 'public' }, requestContext: { authorizer: apiKey({ role: 'staff' }) } } as any, {})
    expect(res.statusCode).toBe(404)
  })

  it('leaves a signed-in user\'s answers as they were', async () => {
    stubHandler('/accounts/list')
    const res = await list({ userId: 'user-1', role: 'user', authType: 'jwt' })
    expect(res.statusCode).toBe(200)
    expect(res.headers).not.toHaveProperty('X-RateLimit-Limit')
  })
})
