import { router } from '../../../router'
import { issueApiKey, revokeApiKey } from '../../../../utils/apiKeyIssuer'
import { getRecord, queryItemFromIndex, queryRecord, scanItems, updateItem } from '../../../../utils/db'
import { getMerchant, listMembers } from '../../../../utils/merchant'
import { getUserEmail } from '../../../../utils/cognito'
import { getEmailProvider } from '../../../../utils/EmailProvider'

jest.mock('../../../../utils/apiKeyIssuer', () => ({ issueApiKey: jest.fn(), revokeApiKey: jest.fn() }))
jest.mock('../../../../utils/db', () => ({
  ...jest.requireActual('../../../../utils/db'),
  getRecord: jest.fn(),
  queryItemFromIndex: jest.fn(),
  queryRecord: jest.fn(),
  scanItems: jest.fn(),
  updateItem: jest.fn(),
}))
jest.mock('../../../../utils/merchant', () => ({ ...jest.requireActual('../../../../utils/merchant'), getMerchant: jest.fn(), listMembers: jest.fn() }))
jest.mock('../../../../utils/cognito', () => ({ getUserEmail: jest.fn() }))
jest.mock('../../../../utils/EmailProvider', () => ({ getEmailProvider: jest.fn() }))

const keyId = 'lk_live_0123456789abcdef'
const secret = 'lks_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG'
const user = { userId: 'user-1', role: 'user', authType: 'jwt' }
const staff = { userId: 'staff-1', role: 'staff', authType: 'jwt' }
const row = (extra: Record<string, any> = {}) => ({
  id: keyId,
  ownerType: 'user',
  ownerId: 'user-1',
  merchantId: 'acme',
  name: 'bot',
  permissions: ['accounts:read'],
  status: 'active',
  rateLimit: { perSecond: 10 },
  createdAt: '2026-10-15T10:00:00.000Z',
  createdBy: 'user-1',
  ...extra,
})

const call = (method: string, path: string, authorizer: Record<string, string>, body?: unknown, query?: Record<string, string>) =>
  router({
    path: `/v1${path}`,
    httpMethod: method,
    body: body === undefined ? null : JSON.stringify(body),
    queryStringParameters: query ?? null,
    requestContext: { authorizer },
  } as any, {})
const parsed = (res: { statusCode: number, body: string }) => [res.statusCode, JSON.parse(res.body)]
const codeOf = (res: { statusCode: number, body: string }) => [res.statusCode, JSON.parse(res.body).error_code]

beforeEach(() => {
  process.env.BRAND_NAME = 'Loudibly'
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.mocked(getEmailProvider).mockReturnValue({ sendEmail: jest.fn().mockResolvedValue(undefined) })
  jest.mocked(getUserEmail).mockResolvedValue('owner@example.com')
  jest.mocked(listMembers).mockResolvedValue({ success: true, res: [] })
  jest.mocked(queryRecord).mockResolvedValue({ success: true, res: [{ id: 'user-1', sk: 'USERPROFILE', merchantId: 'acme', deleted_at: null }] })
  jest.mocked(queryItemFromIndex).mockResolvedValue({ success: true, res: [] } as any)
  jest.mocked(issueApiKey).mockResolvedValue({ ok: true, keyId, secret, key: row() as any })
  jest.mocked(revokeApiKey).mockResolvedValue({ ok: true, keyId, alreadyRevoked: false })
  jest.mocked(getRecord).mockResolvedValue({ success: true, res: row({ status: 'revoked' }) })
  jest.mocked(getMerchant).mockResolvedValue({ success: true, res: { id: 'acme', sk: 'PROFILE', status: 'active' } })
})
afterEach(() => {
  jest.resetAllMocks()
  jest.restoreAllMocks()
  delete process.env.BRAND_NAME
})

// docs/public-api-plan.md step 2.6: a user's own keys
describe('/accounts/api-keys', () => {
  it('lists the permissions a user\'s key may hold', async () => {
    const [status, body] = parsed(await call('GET', '/accounts/api-keys/permissions', user))
    expect(status).toBe(200)
    expect(body.permissions.map((p: { name: string }) => p.name)).toContain('accounts:read')
    expect(body.permissions.map((p: { name: string }) => p.name)).not.toContain('users:create')
  })

  it('creates a key under the user\'s merchant, answering its secret once', async () => {
    const [status, body] = parsed(await call('POST', '/accounts/api-keys/create', user, { name: 'bot', permissions: ['accounts:read'] }))
    expect(status).toBe(200)
    expect(body.secret).toBe(secret)
    expect(issueApiKey).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'user', ownerId: 'user-1', merchantId: 'acme', createdBy: 'user-1', perSecond: 10 }))
  })

  it('takes the system merchant for a user whose profile names none', async () => {
    jest.mocked(queryRecord).mockResolvedValue({ success: true, res: [{ id: 'user-1', sk: 'USERPROFILE', deleted_at: null }] })
    await call('POST', '/accounts/api-keys/create', user, { name: 'bot', permissions: ['accounts:read'] })
    expect(issueApiKey).toHaveBeenCalledWith(expect.objectContaining({ merchantId: 'internal-001' }))
  })

  it.each([
    ['no profile', []],
    ['a deleted profile', [{ id: 'user-1', sk: 'USERPROFILE', deleted_at: '2026-10-01' }]],
  ])('refuses a user with %s: 100063', async (_, res) => {
    jest.mocked(queryRecord).mockResolvedValue({ success: true, res })
    expect(codeOf(await call('POST', '/accounts/api-keys/create', user, { name: 'bot', permissions: ['accounts:read'] }))).toEqual([400, 100063])
    expect(issueApiKey).not.toHaveBeenCalled()
  })

  it.each([
    ['no permissions', { name: 'bot', permissions: [] }, 100031],
    ['no name', { permissions: ['accounts:read'] }, 100029],
    ['a blank name', { name: '   ', permissions: ['accounts:read'] }, 100031],
    ['a rate limit', { name: 'bot', permissions: ['accounts:read'], perSecond: 100 }, 100031],
    ['an expiry that is not a date', { name: 'bot', permissions: ['accounts:read'], expiresAt: 'soon' }, 100031],
  ])('refuses a create with %s', async (_, body, code) => {
    expect(codeOf(await call('POST', '/accounts/api-keys/create', user, body))[1]).toBe(code)
    expect(issueApiKey).not.toHaveBeenCalled()
  })

  it('lists the caller\'s own keys, newest first', async () => {
    jest.mocked(queryItemFromIndex).mockResolvedValue({ success: true, res: [row({ id: 'old' }), row({ id: 'new' })] } as any)
    const [, body] = parsed(await call('GET', '/accounts/api-keys/list', user))
    expect(body.keys.map((k: { keyId: string }) => k.keyId)).toEqual(['new', 'old'])
    expect(jest.mocked(queryItemFromIndex).mock.calls[0][0].attributeValues).toEqual({ ':owner': 'user-1' })
  })

  it('changes a key\'s name, permissions and allowlist, only if it is the caller\'s and active', async () => {
    jest.mocked(updateItem).mockResolvedValue({ success: true, res: { Attributes: {} }, error: null } as any)
    const res = await call('POST', '/accounts/api-keys/update', user, { keyId, name: ' new ', permissions: ['transfers:create', 'accounts:read'], ipAllowlist: [] })
    expect(res.statusCode).toBe(200)
    const update = jest.mocked(updateItem).mock.calls[0][0]
    expect(update.conditionExpression).toBe('ownerId = :owner AND #status = :active')
    expect(update.attributeValues).toMatchObject({ ':owner': 'user-1', ':name': 'new', ':permissions': ['accounts:read', 'transfers:create'] })
    // An empty allowlist lets any IP in again
    expect(update.updateExpression).toMatch(/REMOVE ipAllowlist$/)
  })

  it('answers 404 100060 when the key is someone else\'s, revoked or missing', async () => {
    jest.mocked(updateItem).mockResolvedValue({ success: false, res: null, error: { name: 'ConditionalCheckFailedException' } } as any)
    expect(codeOf(await call('POST', '/accounts/api-keys/update', user, { keyId, name: 'x' }))).toEqual([404, 100060])
  })

  it('refuses an update that changes nothing, or a bad permission or address', async () => {
    expect(codeOf(await call('POST', '/accounts/api-keys/update', user, { keyId }))[1]).toBe(100029)
    expect(codeOf(await call('POST', '/accounts/api-keys/update', user, { keyId, permissions: ['users:read'] }))).toEqual([400, 100058])
    expect(codeOf(await call('POST', '/accounts/api-keys/update', user, { keyId, ipAllowlist: ['nope'] }))).toEqual([400, 100062])
    expect(updateItem).not.toHaveBeenCalled()
  })

  it('revokes only the caller\'s own key', async () => {
    const res = await call('POST', '/accounts/api-keys/revoke', user, { keyId })
    expect(parsed(res)).toEqual([200, { success: true, keyId, status: 'revoked' }])
    expect(revokeApiKey).toHaveBeenCalledWith({ keyId, revokedBy: 'user-1', ownerId: 'user-1' })
  })

  it.each([
    ['an API key', { userId: 'user-1', role: 'user', authType: 'apikey', ownerType: 'user', permissions: 'accounts:read', throttled: 'false' }, 404],
    ['an HMAC key', { userId: 'acme', role: 'admin', authType: 'key', merchantId: 'acme' }, 403],
  ])('takes no %s: keys are managed from a signed-in session', async (_, authorizer, status) => {
    const res = await call('POST', '/accounts/api-keys/create', authorizer, { name: 'bot', permissions: ['accounts:read'] })
    // An API key never reaches the route off the public API (404); an HMAC key is refused by it
    expect(res.statusCode).toBe(status)
    if (status === 403) expect(JSON.parse(res.body).error_code).toBe(100057)
    expect(issueApiKey).not.toHaveBeenCalled()
  })
})

// docs/public-api-plan.md step 2.6: staff, for every key
describe('/merchants/api-keys', () => {
  it('creates a merchant\'s key with merchant permissions', async () => {
    jest.mocked(issueApiKey).mockResolvedValue({ ok: true, keyId, secret, key: row({ ownerType: 'merchant', ownerId: 'acme' }) as any })
    const res = await call('POST', '/merchants/api-keys/create', staff, { merchantId: 'acme', name: 'platform', permissions: ['users:create'] })
    expect(res.statusCode).toBe(200)
    expect(issueApiKey).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'merchant', ownerId: 'acme', merchantId: 'acme', createdBy: 'staff-1' }))
  })

  it('refuses a merchant that is not active, and a user\'s permission', async () => {
    jest.mocked(getMerchant).mockResolvedValue({ success: true, res: { status: 'suspended' } })
    expect(codeOf(await call('POST', '/merchants/api-keys/create', staff, { merchantId: 'acme', name: 'p', permissions: ['users:create'] }))).toEqual([400, 100040])
    jest.mocked(getMerchant).mockResolvedValue({ success: true, res: null })
    expect(codeOf(await call('POST', '/merchants/api-keys/create', staff, { merchantId: 'gone', name: 'p', permissions: ['users:create'] }))).toEqual([400, 100040])
    jest.mocked(getMerchant).mockResolvedValue({ success: true, res: { status: 'active' } })
    expect(codeOf(await call('POST', '/merchants/api-keys/create', staff, { merchantId: 'acme', name: 'p', permissions: ['accounts:read'] }))).toEqual([400, 100058])
    expect(issueApiKey).not.toHaveBeenCalled()
  })

  it('is for staff only', async () => {
    for (const path of ['/merchants/api-keys/create', '/merchants/api-keys/revoke', '/merchants/api-keys/rate-limit']) {
      expect((await call('POST', path, user, {})).statusCode).toBe(403)
    }
    expect((await call('GET', '/merchants/api-keys/list', user)).statusCode).toBe(403)
  })

  it('lists every key, narrowed by the filters, newest first', async () => {
    jest.mocked(scanItems).mockResolvedValue({ success: true,
      res: [
        row({ id: 'a', createdAt: '2026-10-01' }),
        row({ id: 'b', ownerType: 'merchant', ownerId: 'acme', createdAt: '2026-10-03' }),
        row({ id: 'c', status: 'revoked', createdAt: '2026-10-02' }),
      ] })
    const ids = async (query?: Record<string, string>) =>
      JSON.parse((await call('GET', '/merchants/api-keys/list', staff, undefined, query)).body).keys.map((k: { keyId: string }) => k.keyId)
    expect(await ids()).toEqual(['b', 'c', 'a'])
    expect(await ids({ status: 'active' })).toEqual(['b', 'a'])
    expect(await ids({ ownerType: 'merchant' })).toEqual(['b'])
    expect(codeOf(await call('GET', '/merchants/api-keys/list', staff, undefined, { status: 'gone' }))[1]).toBe(100031)
  })

  it('sets one key\'s rate limit', async () => {
    jest.mocked(updateItem).mockResolvedValue({ success: true, res: {}, error: null } as any)
    const [status, body] = parsed(await call('POST', '/merchants/api-keys/rate-limit', staff, { keyId, perSecond: 50 }))
    expect([status, body.keyIds]).toEqual([200, [keyId]])
    expect(jest.mocked(updateItem).mock.calls[0][0].attributeValues[':rate']).toEqual({ perSecond: 50 })
  })

  it('sets every usable key of one owner, and answers 100060 when there is none', async () => {
    jest.mocked(updateItem).mockResolvedValue({ success: true, res: {}, error: null } as any)
    jest.mocked(queryItemFromIndex).mockResolvedValue({ success: true, res: [row({ id: 'k1' }), row({ id: 'k2', status: 'revoked' }), row({ id: 'k3' })] } as any)
    expect(JSON.parse((await call('POST', '/merchants/api-keys/rate-limit', staff, { userId: 'user-1', perSecond: 5 })).body).keyIds).toEqual(['k1', 'k3'])
    jest.mocked(queryItemFromIndex).mockResolvedValue({ success: true, res: [row({ status: 'revoked' })] } as any)
    expect(codeOf(await call('POST', '/merchants/api-keys/rate-limit', staff, { userId: 'user-1', perSecond: 5 }))).toEqual([404, 100060])
  })

  it('refuses a rate limit for both a key and an owner, or out of range', async () => {
    expect(codeOf(await call('POST', '/merchants/api-keys/rate-limit', staff, { keyId, userId: 'u', perSecond: 5 }))[1]).toBe(100031)
    expect(codeOf(await call('POST', '/merchants/api-keys/rate-limit', staff, { keyId, perSecond: 0 }))[1]).toBe(100031)
    expect(codeOf(await call('POST', '/merchants/api-keys/rate-limit', staff, { keyId, perSecond: 1001 }))[1]).toBe(100031)
  })

  it('revokes any key, with the reason', async () => {
    expect((await call('POST', '/merchants/api-keys/revoke', staff, { keyId, reason: ' leaked ' })).statusCode).toBe(200)
    expect(revokeApiKey).toHaveBeenCalledWith({ keyId, revokedBy: 'staff-1', reason: 'leaked' })
    expect(codeOf(await call('POST', '/merchants/api-keys/revoke', staff, { keyId }))[1]).toBe(100029)
  })
})
