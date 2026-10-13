import { router, routes } from './router'

const post = (path: string, body: unknown) =>
  router({ path, httpMethod: 'POST', body: JSON.stringify(body) }, {})

// Replaces a route's handler so no test reaches AWS, Tatum or DynamoDB
const stubHandler = (path: string) => {
  const execute = jest.spyOn(routes.get(path)!.handler.prototype, 'execute')
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
