import { idempotencyKeyOf, withIdempotency } from './idempotency'
import { queryRecord, updateItem } from './db'

jest.mock('./db', () => ({ queryRecord: jest.fn(), updateItem: jest.fn() }))

// v2CustomerTable in memory: enough of updateItem for the claim's condition and the two SETs
const rows = new Map<string, Record<string, any>>()
const keyOf = (key: { id: string, sk: string }) => `${key.id}|${key.sk}`

beforeEach(() => {
  rows.clear()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.mocked(updateItem).mockImplementation(async ({ key, conditionExpression, attributeValues }) => {
    const row = rows.get(keyOf(key as any))
    if (conditionExpression && row && !(row.ttl < attributeValues[':now'])) {
      return { success: false, res: null, error: { name: 'ConditionalCheckFailedException' } } as any
    }
    const next = { ...(conditionExpression ? {} : row), ...key } as Record<string, any>
    if (attributeValues[':running']) Object.assign(next, { state: 'running', requestHash: attributeValues[':hash'], createdAt: attributeValues[':now'], ttl: attributeValues[':expires'] })
    if (attributeValues[':done']) Object.assign(next, { state: 'done', statusCode: attributeValues[':status'], responseBody: attributeValues[':body'] })
    rows.set(keyOf(key as any), next)
    return { success: true, res: {}, error: null } as any
  })
  jest.mocked(queryRecord).mockImplementation(async (_t, _k, values) => {
    const row = rows.get(`${values[':id']}|${values[':sk']}`)
    return { success: true, res: row ? [row] : [] } as any
  })
})
afterEach(() => jest.restoreAllMocks())

const answer = (n: number) => ({ statusCode: 200, headers: {}, body: JSON.stringify({ n }) })

const call = (overrides: Partial<Parameters<typeof withIdempotency>[0]> = {}) => withIdempotency({
  caller: 'jwt:user-1',
  key: 'key-1',
  method: 'POST',
  path: '/accounts/withdraw',
  body: { accountNumber: 'PCF1', cryptoAmount: 1 },
  required: false,
  run: async () => answer(1),
  ...overrides,
})

const codeOf = (res: { statusCode: number, body: string }) => [res.statusCode, JSON.parse(res.body).error_code]

// docs/public-api-plan.md step 1.4: a retried withdrawal sent the coins twice
describe('withIdempotency', () => {
  it('runs once and answers a retry with the first answer, marked as replayed', async () => {
    const run = jest.fn(async () => answer(1))
    const first = await call({ run })
    const again = await call({ run })
    expect(run).toHaveBeenCalledTimes(1)
    expect(again.body).toBe(first.body)
    expect(again.statusCode).toBe(200)
    expect(again.headers).toMatchObject({ 'Idempotent-Replayed': 'true' })
  })

  it('replays a refusal too: the same request gets the same answer', async () => {
    await call({ run: async () => ({ statusCode: 400, headers: {}, body: '{"error_code":100007}' }) })
    const run = jest.fn(async () => answer(2))
    const again = await call({ run })
    expect(run).not.toHaveBeenCalled()
    expect(codeOf(again)).toEqual([400, 100007])
  })

  it('takes a body with its fields in another order as the same request', async () => {
    await call()
    const run = jest.fn(async () => answer(2))
    await call({ run, body: { cryptoAmount: 1, accountNumber: 'PCF1' } })
    expect(run).not.toHaveBeenCalled()
  })

  it.each([
    ['another body', { body: { accountNumber: 'PCF1', cryptoAmount: 2 } }],
    ['another route', { path: '/accounts/transfer' }],
  ])('answers 409 100061 for the same key with %s, running nothing', async (_, change) => {
    await call()
    const run = jest.fn(async () => answer(2))
    const res = await call({ run, ...change })
    expect(codeOf(res)).toEqual([409, 100061])
    expect(JSON.parse(res.body).message).toContain('different request')
    expect(run).not.toHaveBeenCalled()
  })

  it('answers 409 100061 while the first request with the key is still running', async () => {
    let finish: () => void = () => {}
    const first = call({ run: () => new Promise(resolve => { finish = () => resolve(answer(1)) }) })
    await new Promise(resolve => setImmediate(resolve))
    const second = await call({ run: async () => answer(2) })
    expect(codeOf(second)).toEqual([409, 100061])
    expect(JSON.parse(second.body).message).toContain('has not finished')
    finish()
    expect(JSON.parse((await first).body)).toEqual({ n: 1 })
  })

  it('leaves the key claimed when the handler throws, so the operation is never run again on its own', async () => {
    await expect(call({ run: async () => { throw new Error('lost') } })).rejects.toThrow('lost')
    const run = jest.fn(async () => answer(2))
    expect(codeOf(await call({ run }))).toEqual([409, 100061])
    expect(run).not.toHaveBeenCalled()
  })

  it('runs again once the key has expired, even before DynamoDB removes the row', async () => {
    await call()
    for (const row of rows.values()) row.ttl = Math.floor(Date.now() / 1000) - 1
    const run = jest.fn(async () => answer(2))
    expect(JSON.parse((await call({ run })).body)).toEqual({ n: 2 })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('keeps each caller\'s keys apart', async () => {
    await call()
    const run = jest.fn(async () => answer(2))
    await call({ run, caller: 'jwt:user-2' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs as before without a key, unless one is required', async () => {
    const run = jest.fn(async () => answer(1))
    await call({ run, key: undefined })
    await call({ run, key: undefined })
    expect(run).toHaveBeenCalledTimes(2)
    expect(rows.size).toBe(0)

    const required = await call({ run, key: undefined, required: true })
    expect(codeOf(required)).toEqual([400, 100029])
    expect(run).toHaveBeenCalledTimes(2)
  })

  it.each(['has space', 'x'.repeat(256), 'quote"', 'slash/'])('refuses the key %p with 100031, running nothing', async key => {
    const run = jest.fn(async () => answer(1))
    expect(codeOf(await call({ run, key }))).toEqual([400, 100031])
    expect(run).not.toHaveBeenCalled()
  })

  it('runs nothing when the key cannot be claimed', async () => {
    jest.mocked(updateItem).mockResolvedValue({ success: false, res: null, error: { name: 'InternalServerError' } } as any)
    const run = jest.fn(async () => answer(1))
    expect(codeOf(await call({ run }))).toEqual([500, 100002])
    expect(run).not.toHaveBeenCalled()
  })
})

describe('idempotencyKeyOf', () => {
  it('reads the header whatever case its name is in', () => {
    expect(idempotencyKeyOf({ 'Idempotency-Key': 'a' })).toBe('a')
    expect(idempotencyKeyOf({ 'idempotency-key': 'b' })).toBe('b')
    expect(idempotencyKeyOf({ Other: 'c' })).toBeUndefined()
    expect(idempotencyKeyOf(null)).toBeUndefined()
  })
})
