import { TronSaveProvider } from './tronsave'

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

describe('TronSaveProvider.rent', () => {
  const provider = new TronSaveProvider()
  const request = { resource: 'ENERGY' as const, receiver: 'TSender', amount: 64_928 }
  const order = { resourceType: 'ENERGY', resourceAmount: 64_928, durationSec: 900, receiver: 'TSender', unitPrice: 'MEDIUM' }

  it('quotes, then places the order only when it can be filled whole', async () => {
    fetchMock.mockResolvedValueOnce(quote(64_928)).mockResolvedValueOnce(answer(200, { data: { orderId: 'ts-1' } }))
    expect(await provider.rent(request)).toEqual({ status: 'placed', orderId: 'ts-1' })
    expect(sent()).toEqual([
      { path: '/v2/estimate-buy-resource', headers: { 'Content-Type': 'application/json', apikey: 'key-1' }, body: order },
      { path: '/v2/buy-resource', headers: { 'Content-Type': 'application/json', apikey: 'key-1' }, body: { ...order, options: { onlyCreateWhenFulfilled: true } } },
    ])
  })

  it('refuses, ordering nothing, when TronSave has too little available', async () => {
    fetchMock.mockResolvedValueOnce(quote(64_000))
    expect(await provider.rent(request)).toEqual({ status: 'refused', reason: 'only 64000 ENERGY available' })
    expect(sent().map((s) => s.path)).toEqual(['/v2/estimate-buy-resource'])
  })

  it('throws when the quote is answered with an error', async () => {
    fetchMock.mockResolvedValueOnce(answer(401, { message: 'invalid api key' }))
    await expect(provider.rent(request)).rejects.toThrow('TronSave POST /v2/estimate-buy-resource -> 401: {"message":"invalid api key"}')
  })

  // An order may exist after a failed buy, so it is never a refusal
  it('throws when the order is answered with an error', async () => {
    fetchMock.mockResolvedValueOnce(quote(64_928)).mockResolvedValueOnce(answer(500, { message: 'internal' }))
    await expect(provider.rent(request)).rejects.toThrow('TronSave POST /v2/buy-resource -> 500')
  })

  it('has no minimum and rents both resources', () => {
    expect(provider.minimum()).toBe(0)
    expect(provider.resources).toEqual(['ENERGY', 'BANDWIDTH'])
  })
})
