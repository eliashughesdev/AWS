import { isTronAccountActive } from '../../ledger/tatum/chains/tron'
import { TronSaveProvider } from './tronsave'

jest.mock('../../ledger/tatum/chains/tron', () => ({ isTronAccountActive: jest.fn() }))

const fetchMock = jest.spyOn(global, 'fetch')
const answer = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }) as Response

// What fetch was sent: the path after the base URL, the headers and the parsed body
const sent = () => fetchMock.mock.calls.map(([url, init]) => ({
  path: String(url).replace('https://tronsave.test', ''),
  headers: init?.headers,
  body: JSON.parse(String(init?.body)),
}))

const quote = (availableResource: number) => answer(200, { data: { unitPrice: 65, estimateTrx: 4_220_320, availableResource } })

beforeAll(() => {
  Object.assign(process.env, { TRONSAVE_BASE_URL: 'https://tronsave.test', TRONSAVE_API_KEY: 'key-1' })
})

beforeEach(() => {
  fetchMock.mockReset()
})

describe('TronSaveProvider.rent', () => {
  const provider = new TronSaveProvider()
  const request = { resource: 'ENERGY' as const, receiver: 'TSender', amount: 64_928 }
  const order = { resourceType: 'ENERGY', resourceAmount: 64_928, durationSec: 900, receiver: 'TSender', unitPrice: 'MEDIUM' }

  it('quotes, then places the order only when it can be filled whole', async () => {
    fetchMock.mockResolvedValueOnce(quote(64_928)).mockResolvedValueOnce(answer(200, { data: { orderId: 'ts-1' } }))
    // The cost is the quote's: the order's answer has only its id
    expect(await provider.rent(request)).toEqual({ status: 'placed', orderId: 'ts-1', costSun: 4_220_320 })
    const options = { onlyCreateWhenFulfilled: true, preventDuplicateIncompleteOrders: true }
    expect(sent()).toEqual([
      { path: '/v2/estimate-buy-resource', headers: { 'Content-Type': 'application/json', apikey: 'key-1' }, body: order },
      { path: '/v2/buy-resource', headers: { 'Content-Type': 'application/json', apikey: 'key-1' }, body: { ...order, options } },
    ])
  })

  it('refuses, ordering nothing, when TronSave has too little available', async () => {
    fetchMock.mockResolvedValueOnce(quote(64_000))
    expect(await provider.rent(request)).toEqual({ status: 'refused', reason: 'only 64000 ENERGY available' })
    expect(sent().map((s) => s.path)).toEqual(['/v2/estimate-buy-resource'])
  })

  // A quote buys nothing, so the next provider may be tried
  it('refuses when the quote is answered with an error', async () => {
    fetchMock.mockResolvedValueOnce(answer(401, { message: 'invalid api key' }))
    expect(await provider.rent(request)).toEqual({ status: 'refused', reason: 'no quote: TronSave POST /v2/estimate-buy-resource -> 401: {"message":"invalid api key"}' })
  })

  it('refuses, calling nothing, when it is not configured', async () => {
    const key = process.env.TRONSAVE_API_KEY
    delete process.env.TRONSAVE_API_KEY
    expect(await provider.rent(request)).toEqual({ status: 'refused', reason: 'no quote: Missing required env var: TRONSAVE_API_KEY' })
    process.env.TRONSAVE_API_KEY = key
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // An order may exist after a failed buy, so it is never a refusal
  it('throws when the order is answered with an error', async () => {
    fetchMock.mockResolvedValueOnce(quote(64_928)).mockResolvedValueOnce(answer(500, { message: 'internal' }))
    await expect(provider.rent(request)).rejects.toThrow('TronSave POST /v2/buy-resource -> 500')
  })

  // energy-rental-plan step 4: on Nile, 32,000 energy or 400 bandwidth was answered 500;
  // 64,000 and 1,000 filled
  it('rents at least 64,000 energy or 1,000 bandwidth', () => {
    expect(provider.minimum('ENERGY')).toBe(64_000)
    expect(provider.minimum('BANDWIDTH')).toBe(1_000)
  })

  it('rents both resources and is given 120 s to deliver', () => {
    expect(provider.resources).toEqual(['ENERGY', 'BANDWIDTH'])
    expect(provider.deliveryTimeoutMs).toBe(120_000)
  })
})

// energy-rental-plan step 3: activation is two legacy v0 calls, then the chain is read
describe('TronSaveProvider.rent activating the receiver', () => {
  const provider = new TronSaveProvider()
  const onActivated = jest.fn(async () => {})
  const request = { resource: 'ENERGY' as const, receiver: 'TCustomer', amount: 64_928, onActivated }
  const status = (value: number) => answer(200, [value])
  const activated = answer(200, { message: 'Success create 1 active address request(s)' })
  const bought = answer(200, { data: { orderId: 'ts-1' } })

  // Starts a rent and lets its polls run, `ms` of them
  async function settle(ms: number) {
    const result = provider.rent(request).then((outcome) => outcome, (err: Error) => err)
    await jest.advanceTimersByTimeAsync(ms)
    return result
  }

  beforeEach(() => {
    jest.useFakeTimers()
    onActivated.mockClear()
    ;(isTronAccountActive as jest.Mock).mockReset().mockResolvedValue(false)
  })

  afterEach(() => jest.useRealTimers())

  it('quotes, activates an inactive receiver, waits until the chain shows it, then buys', async () => {
    fetchMock.mockResolvedValueOnce(quote(64_928)).mockResolvedValueOnce(status(0)).mockResolvedValueOnce(activated).mockResolvedValueOnce(bought)
    ;(isTronAccountActive as jest.Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    expect(await settle(4000)).toEqual({ status: 'placed', orderId: 'ts-1', costSun: 4_220_320 })
    expect(sent().map(({ path, body }) => [path, body.addresses])).toEqual([
      ['/v2/estimate-buy-resource', undefined],
      ['/v0/helper/is-active-address-check', ['TCustomer']],
      ['/v0/helper/multi-active-address', ['TCustomer']],
      ['/v2/buy-resource', undefined],
    ])
    expect(onActivated).toHaveBeenCalledWith(1_500_000)
    expect(isTronAccountActive).toHaveBeenCalledTimes(2)
  })

  it('pays for no activation of an address it finds active', async () => {
    fetchMock.mockResolvedValueOnce(quote(64_928)).mockResolvedValueOnce(status(2)).mockResolvedValueOnce(bought)
    expect(await settle(0)).toMatchObject({ status: 'placed', orderId: 'ts-1' })
    expect(sent().map((s) => s.path)).not.toContain('/v0/helper/multi-active-address')
    expect(onActivated).not.toHaveBeenCalled()
  })

  it('pays for no activation when it has too little to rent', async () => {
    fetchMock.mockResolvedValueOnce(quote(64_000))
    expect(await settle(0)).toEqual({ status: 'refused', reason: 'only 64000 ENERGY available' })
    expect(sent().map((s) => s.path)).toEqual(['/v2/estimate-buy-resource'])
  })

  it.each([
    [1, 'a contract'],
    [3, 'a status it could not read'],
    [4, 'an invalid address'],
  ])('refuses, buying nothing, when the check answers %d (%s)', async (value) => {
    fetchMock.mockResolvedValueOnce(quote(64_928)).mockResolvedValueOnce(status(value))
    expect(await settle(0)).toEqual({ status: 'refused', reason: `activation check answered ${value} for TCustomer` })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onActivated).not.toHaveBeenCalled()
  })

  it('refuses when the check itself fails', async () => {
    fetchMock.mockResolvedValueOnce(quote(64_928)).mockResolvedValueOnce(answer(502, 'Bad Gateway'))
    expect(await settle(0)).toEqual({ status: 'refused', reason: 'no activation check: TronSave POST /v0/helper/is-active-address-check -> 502: "Bad Gateway"' })
  })

  // The request may have been taken: neither a refusal nor a charge
  it('throws, reporting nothing, when the activation request fails', async () => {
    fetchMock.mockResolvedValueOnce(quote(64_928)).mockResolvedValueOnce(status(0)).mockResolvedValueOnce(answer(500, { message: 'internal' }))
    expect(await settle(0)).toEqual(new Error('TronSave POST /v0/helper/multi-active-address -> 500: {"message":"internal"}'))
    expect(onActivated).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('throws, buying nothing, when the paid activation has not shown after 30 s', async () => {
    fetchMock.mockResolvedValueOnce(quote(64_928)).mockResolvedValueOnce(status(0)).mockResolvedValueOnce(activated)
    expect(await settle(30_000)).toEqual(new Error('TronSave\'s activation of TCustomer did not show on chain within 30s'))
    expect(onActivated).toHaveBeenCalledWith(1_500_000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('publishes 1.5 TRX as its activation price', () => {
    expect(provider.activationSun).toBe(1_500_000)
  })
})
