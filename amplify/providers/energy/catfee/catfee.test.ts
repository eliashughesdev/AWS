import { CatFeeProvider, sign } from './catfee'

const fetchMock = jest.spyOn(global, 'fetch')
const answer = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }) as Response
const noAnswer = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })

const order = (fields: Record<string, unknown>) =>
  answer(200, { code: 0, data: { id: 'cf-1', status: 'DELEGATE_SUCCESS', confirm_status: 'UNCONFIRMED', pay_amount_sun: 1_820_000, ...fields } })

// What fetch was sent: method, path with its query, and headers
const sent = () => fetchMock.mock.calls.map(([url, init]) => {
  const u = new URL(String(url))
  return { method: init?.method, path: u.pathname + u.search, query: Object.fromEntries(u.searchParams), headers: init?.headers as Record<string, string>, body: init?.body }
})

const config = { CATFEE_BASE_URL: 'https://catfee.test/', CATFEE_API_KEY: 'key-1', CATFEE_API_SECRET: 'secret-1' }

beforeEach(() => {
  fetchMock.mockReset()
  Object.assign(process.env, config)
})

describe('sign', () => {
  // Worked out with: printf '%s' '<timestamp><method><path>' | openssl dgst -sha256 -hmac test-secret -binary | base64
  it.each([
    ['POST', '/v1/order?quantity=65000&receiver=TRON_ADDRESS&duration=1h', '4M88VxlHNjz/8gfHVY5wIJ4qnIK9Hs0hrRIlfo8U05c='],
    ['GET', '/v1/order/abcd1234', 'm7SlquyEMAH8R2GsEZnxaY5+CyA80k2icTvUJF5Jwiw='],
  ])('signs timestamp + %s + path with the secret', (method, path, expected) => {
    expect(sign('test-secret', '2023-08-26T12:34:56.789Z', method, path)).toBe(expected)
  })
})

describe('CatFeeProvider.rent', () => {
  const provider = new CatFeeProvider()
  const request = { resource: 'ENERGY' as const, receiver: 'TSender', amount: 65_000 }

  it('places a signed order with everything in the query, and no activation', async () => {
    fetchMock.mockResolvedValueOnce(order({}))
    expect(await provider.rent(request)).toEqual({ status: 'placed', orderId: 'cf-1', costSun: 1_820_000 })

    const [call] = sent()
    expect(call.method).toBe('POST')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/catfee\.test\/v1\/order\?/)
    expect(call.query).toEqual({ quantity: '65000', receiver: 'TSender', duration: '1h', client_order_id: expect.any(String), activate: 'false' })
    expect(call.query.client_order_id.length).toBeLessThanOrEqual(64)
    expect(call.body).toBeUndefined()
    const { 'CF-ACCESS-TIMESTAMP': timestamp, 'CF-ACCESS-SIGN': signature, ...rest } = call.headers
    expect(rest).toEqual({ 'Content-Type': 'application/json', 'CF-ACCESS-KEY': 'key-1' })
    expect(timestamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
    // The path signed is the one sent, query included
    expect(signature).toBe(sign('secret-1', timestamp, 'POST', call.path))
  })

  it('uses a new client_order_id for each order', async () => {
    fetchMock.mockResolvedValue(order({}))
    await provider.rent(request)
    await provider.rent(request)
    const [first, second] = sent()
    expect(first.query.client_order_id).not.toBe(second.query.client_order_id)
  })

  it.each(['PAYMENT_SUCCESS', 'DELEGATE_SUCCESS', 'UNKNOWN'])('counts an order with status %s as placed', async (status) => {
    fetchMock.mockResolvedValueOnce(order({ status }))
    expect(await provider.rent(request)).toMatchObject({ status: 'placed', orderId: 'cf-1' })
  })

  it.each(['INSUFFICIENT_BALANCE', 'QUANTITY_TOO_HIGH', 'QUANTITY_TOO_LOW', 'ADDRESS_NOT_ACTIVATED', 'INVALID_ADDRESS', 'DELEGATE_FAIL'])(
    'refuses when the order comes back %s', async (status) => {
      fetchMock.mockResolvedValueOnce(order({ status }))
      expect(await provider.rent(request)).toEqual({ status: 'refused', reason: `order cf-1: ${status}` })
    })

  it.each([
    [201, 'Insufficient balance'],
    [101, 'signature verification failed'],
    [110, 'address not activated'],
  ])('refuses on business code %d, which creates nothing', async (code, msg) => {
    fetchMock.mockResolvedValueOnce(answer(200, { code, msg, data: null }))
    expect(await provider.rent(request)).toEqual({ status: 'refused', reason: `POST /v1/order -> 200: code ${code} ${msg}` })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses on an HTTP 4xx', async () => {
    fetchMock.mockResolvedValueOnce(answer(429, 'Too Many Requests'))
    expect(await provider.rent(request)).toEqual({ status: 'refused', reason: 'POST /v1/order -> 429: Too Many Requests' })
  })

  it('refuses without calling CatFee when it is not configured', async () => {
    delete process.env.CATFEE_API_SECRET
    expect(await provider.rent(request)).toEqual({ status: 'refused', reason: 'CATFEE_BASE_URL, CATFEE_API_KEY or CATFEE_API_SECRET is not set' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['no answer', () => fetchMock.mockRejectedValueOnce(noAnswer())],
    ['an HTTP 5xx', () => fetchMock.mockResolvedValueOnce(answer(502, '<html>Bad Gateway</html>'))],
    ['code 114 (outcome unknown)', () => fetchMock.mockResolvedValueOnce(answer(200, { code: 114, msg: 'unconfirmed' }))],
    ['code 0 with no order', () => fetchMock.mockResolvedValueOnce(answer(200, { code: 0, data: null }))],
  ])('sends the same client_order_id again after %s', async (_, first) => {
    first()
    fetchMock.mockResolvedValueOnce(order({ status: 'PAYMENT_SUCCESS' }))
    expect(await provider.rent(request)).toMatchObject({ status: 'placed', orderId: 'cf-1' })
    const [one, two] = sent()
    expect(two.query).toEqual(one.query)
  })

  it('refuses when the resend returns the first order, failed', async () => {
    fetchMock.mockRejectedValueOnce(noAnswer()).mockResolvedValueOnce(order({ status: 'INSUFFICIENT_BALANCE' }))
    expect(await provider.rent(request)).toEqual({ status: 'refused', reason: 'order cf-1: INSUFFICIENT_BALANCE' })
  })

  // The first may have made an order: only an order answered to the resend says what happened
  it.each([
    ['refused', () => fetchMock.mockResolvedValueOnce(answer(200, { code: 201, msg: 'Insufficient balance' }))],
    ['unclear too', () => fetchMock.mockRejectedValueOnce(noAnswer())],
  ])('throws when the resend is %s', async (_, second) => {
    fetchMock.mockRejectedValueOnce(noAnswer())
    second()
    await expect(provider.rent(request)).rejects.toThrow(/^CatFee order [0-9a-f-]{36} for TSender is unclear: /)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rents energy only, from 65,000', () => {
    expect(provider.minimum()).toBe(65_000)
    expect(provider.resources).toEqual(['ENERGY'])
  })
})

describe('CatFeeProvider.orderState', () => {
  const provider = new CatFeeProvider()

  it('reads the order with a signed GET', async () => {
    fetchMock.mockResolvedValueOnce(order({}))
    await provider.orderState('cf-1')
    const [call] = sent()
    expect(call.method).toBe('GET')
    expect(call.path).toBe('/v1/order/cf-1')
    expect(call.headers['CF-ACCESS-SIGN']).toBe(sign('secret-1', call.headers['CF-ACCESS-TIMESTAMP'], 'GET', '/v1/order/cf-1'))
  })

  it.each([
    [{ status: 'PAYMENT_SUCCESS' }],
    [{ status: 'DELEGATE_SUCCESS', confirm_status: 'UNCONFIRMED' }],
    [{ status: 'DELEGATE_SUCCESS', confirm_status: 'DELEGATION_CONFIRMED' }],
    [{ status: 'UNKNOWN' }],
  ])('is pending while the order may still deliver (%j)', async (fields) => {
    fetchMock.mockResolvedValueOnce(order(fields))
    expect(await provider.orderState('cf-1')).toEqual({ status: 'pending' })
  })

  it.each([
    [{ status: 'DELEGATE_FAIL' }, 'DELEGATE_FAIL'],
    [{ status: 'DELEGATE_SUCCESS', confirm_status: 'DELEGATION_CONFIRMED_FAIL' }, 'DELEGATION_CONFIRMED_FAIL'],
  ])('has failed when the delegation failed (%j)', async (fields, reason) => {
    fetchMock.mockResolvedValueOnce(order(fields))
    expect(await provider.orderState('cf-1')).toEqual({ status: 'failed', reason })
  })

  it('throws when the order cannot be read', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { code: 112, msg: 'not found' }))
    await expect(provider.orderState('cf-1')).rejects.toThrow('CatFee could not read order cf-1: GET /v1/order/cf-1 -> 200: code 112 not found')
  })
})
