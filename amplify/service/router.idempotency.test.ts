import { routeAt, router } from './router'
import { queryRecord, updateItem } from '../utils/db'

jest.mock('../utils/db', () => ({ ...jest.requireActual('../utils/db'), queryRecord: jest.fn(), updateItem: jest.fn() }))

// The claim's row in memory: taken once, then answered from
const rows = new Map<string, Record<string, any>>()

beforeEach(() => {
  rows.clear()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.mocked(updateItem).mockImplementation(async ({ key, conditionExpression, attributeValues }: any) => {
    const id = `${key.id}|${key.sk}`
    if (conditionExpression && rows.has(id)) return { success: false, res: null, error: { name: 'ConditionalCheckFailedException' } } as any
    const row = rows.get(id) ?? { ...key }
    if (attributeValues[':running']) Object.assign(row, { state: 'running', requestHash: attributeValues[':hash'] })
    if (attributeValues[':done']) Object.assign(row, { state: 'done', statusCode: attributeValues[':status'], responseBody: attributeValues[':body'] })
    rows.set(id, row)
    return { success: true, res: {}, error: null } as any
  })
  jest.mocked(queryRecord).mockImplementation(async (_t: any, _k: any, values: any) => {
    const row = rows.get(`${values[':id']}|${values[':sk']}`)
    return { success: true, res: row ? [row] : [] } as any
  })
})
afterEach(() => jest.restoreAllMocks())

const body = { accountNumber: 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4', currency: 'TRON', cryptoAmount: 1, destinationAddress: 'TPPjH6SeHdZQYYR3Yfk6Wr2xrazJc5MPPf' }
const withdraw = (headers: Record<string, string> = {}, authorizer: Record<string, string> = { userId: 'user-1', role: 'user', authType: 'jwt' }) =>
  router({ path: '/v1/accounts/withdraw', httpMethod: 'POST', body: JSON.stringify(body), headers, requestContext: { authorizer } } as any, {})

// docs/public-api-plan.md step 1.4
describe('a route that takes an Idempotency-Key', () => {
  it('runs the handler once for two requests with the same key', async () => {
    const execute = jest.spyOn(routeAt('/accounts/withdraw')!.handler.prototype, 'execute')
      .mockResolvedValue({ statusCode: 200, headers: {}, body: '{"status":"queued"}' })
    const first = await withdraw({ 'Idempotency-Key': 'retry-1' })
    const again = await withdraw({ 'idempotency-key': 'retry-1' })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(again.body).toBe(first.body)
    expect(again.headers).toMatchObject({ 'Idempotent-Replayed': 'true' })
  })

  it('runs every request without a key, as before', async () => {
    const execute = jest.spyOn(routeAt('/accounts/withdraw')!.handler.prototype, 'execute')
      .mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' })
    await withdraw()
    await withdraw()
    expect(execute).toHaveBeenCalledTimes(2)
    expect(updateItem).not.toHaveBeenCalled()
  })

  it('checks the body before the key: a refused body claims nothing', async () => {
    const res = await router({ path: '/accounts/withdraw', httpMethod: 'POST', body: '{}', headers: { 'Idempotency-Key': 'k' }, requestContext: { authorizer: { userId: 'user-1', role: 'user', authType: 'jwt' } } } as any, {})
    expect(JSON.parse(res.body).error_code).toBe(100029)
    expect(updateItem).not.toHaveBeenCalled()
  })
})

describe('a route that does not take one', () => {
  it('ignores the header', async () => {
    const execute = jest.spyOn(routeAt('/accounts/rename')!.handler.prototype, 'execute')
      .mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' })
    const rename = () => router({ path: '/accounts/rename', httpMethod: 'POST', body: JSON.stringify({ accountNumber: body.accountNumber, name: 'x' }), headers: { 'Idempotency-Key': 'k' }, requestContext: { authorizer: { userId: 'user-1', role: 'user', authType: 'jwt' } } } as any, {})
    await rename()
    await rename()
    expect(execute).toHaveBeenCalledTimes(2)
  })
})

describe('every route that moves money', () => {
  it.each(['/accounts/withdraw', '/accounts/transfer', '/accounts/deposit'])('%s takes an Idempotency-Key', path => {
    expect(routeAt(path)?.idempotency).toBeDefined()
  })
})

// docs/public-api-plan.md step 2.5: a key's Idempotency-Keys are its owner's, so a retry through
// either credential is the same request, and two users' keys never meet
describe('an API key', () => {
  const userKey = (userId: string) => ({ userId, role: 'user', authType: 'apikey', ownerType: 'user', permissions: 'withdrawals:create', throttled: 'false' })
  const viaKey = (authorizer: Record<string, string>, key: string) =>
    router({ path: '/v1/accounts/withdraw', httpMethod: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': key }, stageVariables: { API_SURFACE: 'public' }, requestContext: { authorizer } } as any, {})

  it('shares its user\'s keys with their signed-in session', async () => {
    const execute = jest.spyOn(routeAt('/accounts/withdraw')!.handler.prototype, 'execute')
      .mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' })
    await withdraw({ 'Idempotency-Key': 'shared' })
    const again = await viaKey(userKey('user-1'), 'shared')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(again.headers).toMatchObject({ 'Idempotent-Replayed': 'true' })
    expect([...rows.keys()]).toEqual(['IDEM#jwt:user-1#shared|IDEMPOTENCY'])
  })

  it('keeps two users\' keys apart', async () => {
    const execute = jest.spyOn(routeAt('/accounts/withdraw')!.handler.prototype, 'execute')
      .mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' })
    await viaKey(userKey('user-1'), 'k')
    await viaKey(userKey('user-2'), 'k')
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
