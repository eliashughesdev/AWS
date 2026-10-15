import { createHash } from 'crypto'
import { DeleteParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { handler, type CreateRequest } from './handler'
import { getRecord, putItem, updateItem } from '../../utils/db'

jest.mock('../../utils/db', () => ({ getRecord: jest.fn(), putItem: jest.fn(), updateItem: jest.fn() }))

// SSM in memory: parameter name → value
const parameters = new Map<string, string>()
let ssmSend: jest.SpiedFunction<SSMClient['send']>
const rows = new Map<string, Record<string, any>>()
const logged: string[] = []

const failWith = (name: string) => Object.assign(new Error(name), { name })

beforeEach(() => {
  parameters.clear()
  rows.clear()
  logged.length = 0
  for (const level of ['log', 'error'] as const) {
    jest.spyOn(console, level).mockImplementation((...args) => { logged.push(args.map(String).join(' ')) })
  }
  ssmSend = jest.spyOn(SSMClient.prototype, 'send')
  ssmSend.mockImplementation(async (command: any) => {
    const input = command.input
    if (command instanceof PutParameterCommand) {
      if (parameters.has(input.Name)) throw failWith('ParameterAlreadyExists')
      parameters.set(input.Name, input.Value)
    } else if (command instanceof DeleteParameterCommand) {
      if (!parameters.delete(input.Name)) throw failWith('ParameterNotFound')
    }
    return {}
  })
  jest.mocked(putItem).mockReset().mockImplementation(async (_table, item) => {
    rows.set(item.id, item)
    return { success: true, res: {}, error: null } as any
  })
  jest.mocked(getRecord).mockReset().mockImplementation(async (_table, id) => ({ success: true, res: rows.get(id) ?? null }))
  // Enough of UpdateItem for revoke's condition
  jest.mocked(updateItem).mockReset().mockImplementation(async ({ key, attributeValues }) => {
    const row = rows.get(key.id)
    if (!row || row.status === 'revoked' || (attributeValues[':owner'] !== undefined && row.ownerId !== attributeValues[':owner'])) {
      return { success: false, res: null, error: { name: 'ConditionalCheckFailedException' } } as any
    }
    Object.assign(row, { status: 'revoked', revokedAt: attributeValues[':now'], revokedBy: attributeValues[':by'] })
    if (attributeValues[':reason']) row.revokeReason = attributeValues[':reason']
    return { success: true, res: {}, error: null } as any
  })
})
afterEach(() => jest.restoreAllMocks())

const request = (overrides: Partial<CreateRequest> = {}): CreateRequest => ({
  op: 'create',
  ownerType: 'user',
  ownerId: 'user-1',
  merchantId: 'internal-001',
  name: ' Accounting bot ',
  permissions: ['withdrawals:create', 'accounts:read', 'accounts:read'],
  perSecond: 10,
  createdBy: 'user-1',
  ...overrides,
})

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

// The secret and its hash appear nowhere but in create's answer and the SSM parameter (D2.2)
const expectNotLogged = (...values: string[]) => {
  for (const value of values) expect(logged.join('\n')).not.toContain(value)
}

describe('apiKeyIssuerFn create', () => {
  it('stores only the SHA-256 of a new secret, as a SecureString, and the row without either', async () => {
    const res = await handler(request()) as any
    expect(res.ok).toBe(true)
    expect(res.keyId).toMatch(/^lk_live_[0-9a-f]{16}$/)
    expect(res.secret).toMatch(/^lks_[A-Za-z0-9_-]{43}$/)

    const put = ssmSend.mock.calls.map(([command]) => command).find(c => c instanceof PutParameterCommand)!.input as any
    expect(put).toMatchObject({
      Name: `/loudibly/api-keys/${res.keyId}`, Type: 'SecureString', KeyId: 'alias/loudibly-api-keys', Overwrite: false,
    })
    expect(put.Value).toBe(sha256(res.secret))

    expect(putItem).toHaveBeenCalledWith('v1ApiKeysTable', expect.any(Object), 'attribute_not_exists(id)')
    const row = rows.get(res.keyId)!
    expect(row).toMatchObject({
      id: res.keyId,
      ownerType: 'user',
      ownerId: 'user-1',
      merchantId: 'internal-001',
      name: 'Accounting bot',
      permissions: ['accounts:read', 'withdrawals:create'],
      status: 'active',
      rateLimit: { perSecond: 10 },
      createdBy: 'user-1',
    })
    expect(row).not.toHaveProperty('ipAllowlist')
    expect(JSON.stringify(row)).not.toContain(res.secret)
    expect(JSON.stringify(row)).not.toContain(put.Value)
    expect(res.key).toEqual(row)
    expectNotLogged(res.secret, put.Value)
  })

  it('makes a different key and secret every time', async () => {
    const [a, b] = await Promise.all([handler(request()), handler(request())]) as any[]
    expect(a.keyId).not.toBe(b.keyId)
    expect(a.secret).not.toBe(b.secret)
  })

  it('keeps an IP allowlist and an expiry when given', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString()
    const res = await handler(request({ ipAllowlist: ['203.0.113.7', '2001:db8::1'], expiresAt })) as any
    expect(rows.get(res.keyId)).toMatchObject({ ipAllowlist: ['203.0.113.7', '2001:db8::1'], expiresAt })
  })

  it('takes another id when the one drawn is taken', async () => {
    let first = true
    ssmSend.mockImplementation(async (command: any) => {
      if (command instanceof PutParameterCommand && first) { first = false; throw failWith('ParameterAlreadyExists') }
      return {}
    })
    const res = await handler(request()) as any
    expect(res.ok).toBe(true)
    const names = ssmSend.mock.calls.map(([c]: any) => c.input.Name)
    expect(names).toHaveLength(2)
    expect(names[0]).not.toBe(names[1])
    expect(names[1]).toBe(`/loudibly/api-keys/${res.keyId}`)
  })

  it('writes no row when the hash cannot be stored', async () => {
    ssmSend.mockRejectedValue(failWith('AccessDeniedException') as never)
    expect(await handler(request())).toEqual({ ok: false, error: 'failed' })
    expect(putItem).not.toHaveBeenCalled()
  })

  it('deletes the hash again when the row cannot be written', async () => {
    jest.mocked(putItem).mockResolvedValue({ success: false, res: null, error: { name: 'ProvisionedThroughputExceededException' } } as any)
    expect(await handler(request())).toEqual({ ok: false, error: 'failed' })
    expect(parameters.size).toBe(0)
    expect(ssmSend.mock.calls.some(([c]) => c instanceof DeleteParameterCommand)).toBe(true)
  })

  it.each<[string, Partial<CreateRequest>]>([
    ['ownerType', { ownerType: 'staff' as any }],
    ['ownerId', { ownerId: ' ' }],
    ['merchantId', { merchantId: '' }],
    ['name', { name: 'x'.repeat(65) }],
    ['permissions', { permissions: [] }],
    ['permissions', { permissions: ['accounts:read', 'accounts:delete'] }],
    // A merchant's permission on a user's key, and the reverse
    ['permissions', { permissions: ['users:create'] }],
    ['permissions', { ownerType: 'merchant', ownerId: 'acme', merchantId: 'acme', permissions: ['accounts:read'] }],
    ['perSecond', { perSecond: 0 }],
    ['perSecond', { perSecond: 2.5 }],
    ['ipAllowlist', { ipAllowlist: Array.from({ length: 21 }, (_, i) => `203.0.113.${i}`) }],
    ['expiresAt', { expiresAt: '2020-01-01T00:00:00Z' }],
    ['expiresAt', { expiresAt: 'tomorrow' }],
    ['createdBy', { createdBy: undefined as any }],
  ])('refuses a bad %s, writing nothing', async (field, change) => {
    expect(await handler(request(change))).toEqual({ ok: false, error: 'invalid', field })
    expect(ssmSend).not.toHaveBeenCalled()
    expect(putItem).not.toHaveBeenCalled()
  })

  it('creates a merchant key with merchant permissions', async () => {
    const res = await handler(request({ ownerType: 'merchant', ownerId: 'acme', merchantId: 'acme', permissions: ['users:create'], createdBy: 'staff-1' })) as any
    expect(rows.get(res.keyId)).toMatchObject({ ownerType: 'merchant', ownerId: 'acme', permissions: ['users:create'] })
  })
})

describe('apiKeyIssuerFn revoke', () => {
  const created = async () => (await handler(request())) as any

  it('marks the row revoked, then deletes the hash', async () => {
    const { keyId } = await created()
    const res = await handler({ op: 'revoke', keyId, revokedBy: 'staff-1', reason: 'leaked' })
    expect(res).toEqual({ ok: true, keyId, alreadyRevoked: false })
    expect(rows.get(keyId)).toMatchObject({ status: 'revoked', revokedBy: 'staff-1', revokeReason: 'leaked' })
    expect(parameters.has(`/loudibly/api-keys/${keyId}`)).toBe(false)
    expect(jest.mocked(updateItem).mock.invocationCallOrder[0]).toBeLessThan(ssmSend.mock.invocationCallOrder.at(-1)!)
  })

  it('revokes an owner\'s own key, and answers not_found for anyone else\'s', async () => {
    const { keyId } = await created()
    expect(await handler({ op: 'revoke', keyId, revokedBy: 'user-2', ownerId: 'user-2' })).toEqual({ ok: false, error: 'not_found' })
    expect(rows.get(keyId)!.status).toBe('active')
    expect(parameters.has(`/loudibly/api-keys/${keyId}`)).toBe(true)
    expect(await handler({ op: 'revoke', keyId, revokedBy: 'user-1', ownerId: 'user-1' })).toMatchObject({ ok: true })
  })

  it('answers not_found for a key that does not exist', async () => {
    expect(await handler({ op: 'revoke', keyId: 'lk_live_0000000000000000', revokedBy: 'staff-1' })).toEqual({ ok: false, error: 'not_found' })
    expect(ssmSend).not.toHaveBeenCalled()
  })

  it('answers ok for a revoked key, keeping when and by whom, and deletes a hash left behind', async () => {
    const { keyId } = await created()
    await handler({ op: 'revoke', keyId, revokedBy: 'user-1' })
    const revokedAt = rows.get(keyId)!.revokedAt
    parameters.set(`/loudibly/api-keys/${keyId}`, 'left behind')
    expect(await handler({ op: 'revoke', keyId, revokedBy: 'staff-1' })).toEqual({ ok: true, keyId, alreadyRevoked: true })
    expect(rows.get(keyId)).toMatchObject({ revokedAt, revokedBy: 'user-1' })
    expect(parameters.size).toBe(0)
  })

  it('answers ok when the hash cannot be deleted: the row already stops the key', async () => {
    const { keyId } = await created()
    ssmSend.mockRejectedValue(failWith('ThrottlingException') as never)
    expect(await handler({ op: 'revoke', keyId, revokedBy: 'user-1' })).toMatchObject({ ok: true })
    expect(logged.join('\n')).toContain(`${keyId}: its hash could not be deleted`)
  })

  it('fails when the row cannot be updated, deleting nothing', async () => {
    const { keyId } = await created()
    ssmSend.mockClear()
    jest.mocked(updateItem).mockResolvedValue({ success: false, res: null, error: { name: 'InternalServerError' } } as any)
    expect(await handler({ op: 'revoke', keyId, revokedBy: 'user-1' })).toEqual({ ok: false, error: 'failed' })
    expect(ssmSend).not.toHaveBeenCalled()
  })

  it.each([
    ['keyId', { keyId: '' }],
    ['revokedBy', { revokedBy: undefined }],
    ['reason', { reason: 'x'.repeat(501) }],
  ])('refuses a bad %s', async (field, change) => {
    expect(await handler({ op: 'revoke', keyId: 'lk_live_0000000000000000', revokedBy: 'u', ...change } as any)).toEqual({ ok: false, error: 'invalid', field })
  })
})

describe('apiKeyIssuerFn', () => {
  it.each([{ op: 'read' }, { op: 42 }, {}])('refuses %p', async event => {
    expect(await handler(event)).toEqual({ ok: false, error: 'unknown operation' })
  })
})
