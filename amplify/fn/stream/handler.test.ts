import crypto from 'crypto'
import { handler } from './handler'

// Regression (PCI F4): the handler logged every record whole, images included, so each new
// merchant API key and card row reached CloudWatch; and its v1UserKeysTable branch awaited a
// promise that never resolved, so Lambda retried each key record for 24 hours, logging the
// key some 1,600 times
describe('stream handler', () => {
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

  const secretKey = crypto.randomBytes(32).toString('hex')
  const cardData = `ev:encrypted:${crypto.randomBytes(16).toString('hex')}`

  // What a NEW_AND_OLD_IMAGES stream delivered: the row before and after the change
  const record = (table: string, eventName: 'INSERT' | 'MODIFY' | 'REMOVE', keys: object, image: object) => ({
    eventName,
    eventSourceARN: `arn:aws:dynamodb:us-east-2:1:table/${table}/stream/2025-10-09T16:18:21.202`,
    dynamodb: { Keys: keys, NewImage: image, OldImage: image },
  })
  const records = [
    record('v1UserKeysTable', 'INSERT', { id: { S: 'mrc_1' } }, { id: { S: 'mrc_1' }, type: { S: 'hmac' }, key: { S: secretKey } }),
    record('v1UserKeysTable', 'REMOVE', { id: { S: 'mrc_1' } }, { id: { S: 'mrc_1' }, type: { S: 'hmac' }, key: { S: secretKey } }),
    record('v2CustomerTable', 'MODIFY', { id: { S: 'user-1' }, sk: { S: 'PAYMENT#card-1' } }, { id: { S: 'user-1' }, sk: { S: 'PAYMENT#card-1' }, cardData: { S: cardData } }),
  ]
  const run = () => (handler as any)({ Records: records }, {} as any, () => {})

  it('logs no value from a row', async () => {
    await run()
    const all = logged.join('\n')
    expect(all).not.toContain(secretKey)
    expect(all).not.toContain(cardData)
    expect(all).not.toMatch(/NewImage|OldImage/)
  })

  it('logs the event, the table and the keys', async () => {
    await run()
    expect(logged).toEqual([
      'Stream record: {"eventName":"INSERT","table":"v1UserKeysTable","keys":{"id":"mrc_1"}}',
      'Stream record: {"eventName":"REMOVE","table":"v1UserKeysTable","keys":{"id":"mrc_1"}}',
      'Stream record: {"eventName":"MODIFY","table":"v2CustomerTable","keys":{"id":"user-1","sk":"PAYMENT#card-1"}}',
    ])
  })

  it('returns for a key table record', async () => {
    const outcome = await Promise.race([run().then(() => 'returned'), new Promise(resolve => setTimeout(resolve, 1000, 'hung'))])
    expect(outcome).toBe('returned')
  })
})
