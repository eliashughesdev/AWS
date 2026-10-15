import crypto from 'crypto'
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

const { handler } = require('./handler')
const { normalizeIp, parseBasic, resetCaches } = require('./apiKey')

// docs/public-api-plan.md step 2.3: the authorizer's Basic branch

const keyId = 'lk_live_0123456789abcdef'
const secret = `lks_${crypto.randomBytes(32).toString('base64url')}`
const hash = crypto.createHash('sha256').update(secret).digest('hex')

// The tables and SSM in memory
let tables: Record<string, Map<string, Record<string, any>>>
let parameters: Map<string, string>
let dbSend: jest.SpyInstance
let ssmSend: jest.SpyInstance
const logged: string[] = []

const keyOf = (key: Record<string, any>) => JSON.stringify(unmarshall(key), Object.keys(unmarshall(key)).sort())

beforeEach(() => {
  resetCaches()
  logged.length = 0
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg) ?? String(arg)).join(' '))
    })
  }
  const row = (key: Record<string, any>, item: Record<string, any>) => [keyOf(marshall(key)), { ...key, ...item }] as const
  tables = {
    v1ApiKeysTable: new Map([row({ id: keyId }, {
      ownerType: 'user',
      ownerId: 'user-1',
      merchantId: 'internal-001',
      name: 'bot',
      status: 'active',
      permissions: ['accounts:read', 'withdrawals:create'],
      rateLimit: { perSecond: 10 },
    })]),
    v2CustomerTable: new Map([row({ id: 'user-1', sk: 'USERPROFILE' }, { deleted_at: null })]),
    v1MerchantTable: new Map([row({ id: 'acme', sk: 'PROFILE' }, { status: 'active' })]),
    v1ApiKeyUsageTable: new Map(),
  }
  parameters = new Map([[`/loudibly/api-keys/${keyId}`, hash]])

  dbSend = jest.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(async (command: any) => {
    const { TableName, Key } = command.input
    const table = tables[TableName]
    if (command instanceof GetItemCommand) {
      const item = table?.get(keyOf(Key))
      return { Item: item ? marshall(item, { removeUndefinedValues: true }) : undefined }
    }
    if (command instanceof UpdateItemCommand && TableName === 'v1ApiKeyUsageTable') {
      // ADD count :one, only while count < :limit
      const values = unmarshall(command.input.ExpressionAttributeValues!)
      const counter = table.get(keyOf(Key)) ?? { ...unmarshall(Key), ttl: values[':ttl'] }
      if ((counter.count ?? 0) >= values[':limit']) throw Object.assign(new Error('condition'), { name: 'ConditionalCheckFailedException' })
      counter.count = (counter.count ?? 0) + values[':one']
      table.set(keyOf(Key), counter)
      return { Attributes: marshall({ count: counter.count }) }
    }
    if (command instanceof UpdateItemCommand) {
      const item = table.get(keyOf(Key))!
      const values = unmarshall(command.input.ExpressionAttributeValues!)
      if (item.lastUsedAt && item.lastUsedAt >= values[':minuteAgo']) {
        throw Object.assign(new Error('condition'), { name: 'ConditionalCheckFailedException' })
      }
      item.lastUsedAt = values[':now']
      return {}
    }
    throw new Error(`unexpected ${command.constructor.name}`)
  })
  ssmSend = jest.spyOn(SSMClient.prototype, 'send').mockImplementation(async (command: any) => {
    expect(command).toBeInstanceOf(GetParameterCommand)
    expect(command.input.WithDecryption).toBe(true)
    const value = parameters.get(command.input.Name)
    if (value === undefined) throw Object.assign(new Error('missing'), { name: 'ParameterNotFound' })
    return { Parameter: { Value: value } }
  })
})
afterEach(() => jest.restoreAllMocks())

const basic = (id: string, s: string) => `Basic ${Buffer.from(`${id}:${s}`).toString('base64')}`

const event = ({ authorization = basic(keyId, secret), sourceIp = '203.0.113.7', surface = 'public' as string | null, headerName = 'Authorization' } = {}) => ({
  methodArn: 'arn:aws:execute-api:us-east-2:1:api/v1/GET/accounts/list',
  headers: { [headerName]: authorization },
  stageVariables: surface ? { API_SURFACE: surface } : null,
  requestContext: { identity: { sourceIp }, path: '/v1/accounts/list' },
})

const effect = (policy: any) => policy.policyDocument.Statement[0].Effect
const keyRow = () => tables.v1ApiKeysTable.get(keyOf(marshall({ id: keyId })))!

const expectNothingSecretLogged = () => {
  const all = logged.join('\n')
  for (const value of [secret, hash, basic(keyId, secret).slice(6)]) expect(all).not.toContain(value)
}

describe('authorizer: API keys', () => {
  it('lets a user\'s key in as its owner, with its permissions, and logs no secret', async () => {
    const policy = await handler(event())
    expect(effect(policy)).toBe('Allow')
    expect(policy.principalId).toBe('user-1')
    expect(policy.context).toEqual({
      userId: 'user-1',
      role: 'user',
      authType: 'apikey',
      ownerType: 'user',
      keyId,
      permissions: 'accounts:read,withdrawals:create',
      throttled: 'false',
      rateLimit: '10',
      rateRemaining: '9',
      rateReset: String(Math.floor(Date.now() / 1000) + 1),
    })
    expectNothingSecretLogged()
  })

  it('lets a merchant\'s key in as the merchant, as its HMAC key would be', async () => {
    Object.assign(keyRow(), { ownerType: 'merchant', ownerId: 'acme', merchantId: 'acme', permissions: ['users:create'] })
    const policy = await handler(event())
    expect(effect(policy)).toBe('Allow')
    expect(policy.context).toEqual({
      userId: 'acme',
      role: 'admin',
      authType: 'apikey',
      ownerType: 'merchant',
      keyId,
      permissions: 'users:create',
      merchantId: 'acme',
      throttled: 'false',
      rateLimit: '10',
      rateRemaining: '9',
      rateReset: expect.stringMatching(/^\d+$/),
    })
  })

  it('reads the header in any case, and needs no X-Project', async () => {
    expect(effect(await handler(event({ headerName: 'authorization' })))).toBe('Allow')
  })

  it.each<[string, () => void, Parameters<typeof event>[0] | undefined]>([
    ['the internal API', () => {}, { surface: null }],
    ['an unknown key', () => tables.v1ApiKeysTable.clear(), undefined],
    ['a revoked key', () => { keyRow().status = 'revoked' }, undefined],
    ['an expired key', () => { keyRow().expiresAt = new Date(Date.now() - 1000).toISOString() }, undefined],
    ['an IP not on the allowlist', () => { keyRow().ipAllowlist = ['198.51.100.1'] }, undefined],
    ['a wrong secret', () => {}, { authorization: basic(keyId, `lks_${crypto.randomBytes(32).toString('base64url')}`) }],
    ['a key whose hash is gone', () => parameters.clear(), undefined],
    ['a deleted user', () => { tables.v2CustomerTable.values().next().value!.deleted_at = '2026-10-01T00:00:00Z' }, undefined],
    ['a user with no profile', () => tables.v2CustomerTable.clear(), undefined],
    ['a merchant that is not active', () => {
      Object.assign(keyRow(), { ownerType: 'merchant', ownerId: 'acme' })
      tables.v1MerchantTable.values().next().value!.status = 'suspended'
    }, undefined],
    ['a malformed header', () => {}, { authorization: 'Basic not-base64-at-all' }],
    ['a header with no secret', () => {}, { authorization: `Basic ${Buffer.from(keyId).toString('base64')}` }],
  ])('denies %s', async (_, arrange, change) => {
    arrange()
    expect(effect(await handler(event(change)))).toBe('Deny')
    // Refused for its reason, not by an exception that happens to deny as well
    expect(logged.join('\n')).toMatch(/API key \S+: denied, /)
    expect(logged.join('\n')).not.toContain('Catch block executed')
    expectNothingSecretLogged()
  })

  it('lets in an IP on the allowlist, however it is written', async () => {
    keyRow().ipAllowlist = ['198.51.100.1', '2001:DB8::1', '203.0.113.7']
    expect(effect(await handler(event()))).toBe('Allow')
    expect(effect(await handler(event({ sourceIp: '2001:db8:0:0:0:0:0:1' })))).toBe('Allow')
    expect(effect(await handler(event({ sourceIp: '::ffff:198.51.100.1' })))).toBe('Allow')
    expect(effect(await handler(event({ sourceIp: '198.51.100.2' })))).toBe('Deny')
  })

  it('lets in a key whose expiry is still ahead', async () => {
    keyRow().expiresAt = new Date(Date.now() + 60_000).toISOString()
    expect(effect(await handler(event()))).toBe('Allow')
  })

  it('caches the hash but reads the row every call, so revoking applies at once', async () => {
    await handler(event())
    await handler(event())
    expect(ssmSend).toHaveBeenCalledTimes(1)
    keyRow().status = 'revoked'
    expect(effect(await handler(event()))).toBe('Deny')
  })

  it('writes lastUsedAt at most once a minute', async () => {
    await handler(event())
    const first = keyRow().lastUsedAt
    expect(first).toBeDefined()
    await handler(event())
    expect(dbSend.mock.calls.filter(([c]) => c instanceof UpdateItemCommand && c.input.TableName === 'v1ApiKeysTable')).toHaveLength(1)
    expect(keyRow().lastUsedAt).toBe(first)
  })

  it('still lets the key in when lastUsedAt cannot be written', async () => {
    const send = dbSend.getMockImplementation()!
    dbSend.mockImplementation(async (command: any) => {
      if (command instanceof UpdateItemCommand) throw Object.assign(new Error('x'), { name: 'ThrottlingException' })
      return send(command)
    })
    expect(effect(await handler(event()))).toBe('Allow')
  })

  it('denies when the key cannot be checked', async () => {
    dbSend.mockRejectedValue(Object.assign(new Error('down'), { name: 'InternalServerError' }))
    expect(effect(await handler(event()))).toBe('Deny')
  })

  it('denies when SSM cannot be read', async () => {
    ssmSend.mockRejectedValue(Object.assign(new Error('down'), { name: 'ThrottlingException' }))
    expect(effect(await handler(event()))).toBe('Deny')
    expectNothingSecretLogged()
  })

  it('takes a Basic header for a key even when its base64 holds "Signature"', async () => {
    // Without X-Project a Signature header is refused before anything is read; a Basic one is not
    const res = await handler(event({ authorization: 'Basic U2lnbmF0dXJl' }))
    expect(effect(res)).toBe('Deny')
    expect(logged.join('\n')).toContain('Auth Type: Basic')
  })
})

// D2.5: each key's calls per second, counted by the authorizer; over the limit the call is let
// in marked throttled, and the router answers 429
describe('authorizer: rate limit', () => {
  const second = 1_792_000_000
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(second * 1000 + 250))

  const rate = async () => {
    const { context } = await handler(event())
    return [context.throttled, context.rateRemaining]
  }

  it('lets a key make its limit\'s calls in a second, then marks the rest throttled', async () => {
    keyRow().rateLimit = { perSecond: 3 }
    expect(await rate()).toEqual(['false', '2'])
    expect(await rate()).toEqual(['false', '1'])
    expect(await rate()).toEqual(['false', '0'])
    expect(await rate()).toEqual(['true', '0'])
    expect(await rate()).toEqual(['true', '0'])
    // A throttled call is not counted
    expect(tables.v1ApiKeyUsageTable.get(keyOf(marshall({ id: `${keyId}#${second}` })))).toMatchObject({ count: 3, ttl: second + 60 })
    expect(logged.join('\n')).toContain('allowed, over its rate limit')
  })

  it('starts again the next second, and says when', async () => {
    keyRow().rateLimit = { perSecond: 1 }
    await rate()
    const { context } = await handler(event())
    expect(context).toMatchObject({ throttled: 'true', rateLimit: '1', rateReset: String(second + 1) })
    jest.mocked(Date.now).mockReturnValue((second + 1) * 1000)
    expect(await rate()).toEqual(['false', '0'])
  })

  it('counts each key on its own', async () => {
    keyRow().rateLimit = { perSecond: 1 }
    await rate()
    tables.v1ApiKeyUsageTable.set(keyOf(marshall({ id: `lk_live_ffffffffffffffff#${second}` })), { count: 99 })
    expect(await rate()).toEqual(['true', '0'])
    expect(tables.v1ApiKeyUsageTable.size).toBe(2)
  })

  it('applies a changed limit on the next call', async () => {
    keyRow().rateLimit = { perSecond: 1 }
    await rate()
    expect(await rate()).toEqual(['true', '0'])
    keyRow().rateLimit = { perSecond: 5 }
    expect(await rate()).toEqual(['false', '3'])
  })

  it('takes 10 a second for a row with no limit', async () => {
    delete keyRow().rateLimit
    const { context } = await handler(event())
    expect(context).toMatchObject({ throttled: 'false', rateLimit: '10', rateRemaining: '9' })
  })

  it('lets the call through when the counter cannot be written', async () => {
    const send = dbSend.getMockImplementation()!
    dbSend.mockImplementation(async (command: any) => {
      if (command.input.TableName === 'v1ApiKeyUsageTable') throw Object.assign(new Error('x'), { name: 'ProvisionedThroughputExceededException' })
      return send(command)
    })
    const policy = await handler(event())
    expect(effect(policy)).toBe('Allow')
    expect(policy.context.throttled).toBe('false')
  })
})

describe('parseBasic', () => {
  it('reads a key id and secret, and nothing else', () => {
    expect(parseBasic(basic(keyId, secret))).toEqual({ keyId, secret })
    expect(parseBasic(`basic  ${Buffer.from(`${keyId}:${secret}`).toString('base64')}`)).toEqual({ keyId, secret })
    expect(parseBasic(basic('lk_live_short', secret))).toBeNull()
    expect(parseBasic(basic(keyId, 'lks_short'))).toBeNull()
    expect(parseBasic(basic(keyId, `${secret}:extra`))).toBeNull()
  })
})

describe('normalizeIp', () => {
  it('writes each address one way', () => {
    expect(normalizeIp('2001:DB8:0:0:0:0:0:1')).toBe('2001:db8::1')
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(normalizeIp(' 203.0.113.7 ')).toBe('203.0.113.7')
    expect(normalizeIp('203.0.113.0/24')).toBeNull()
    expect(normalizeIp('example.com')).toBeNull()
  })
})
