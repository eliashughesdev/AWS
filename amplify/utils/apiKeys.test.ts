import { checkAllowlist, checkPermissions, createKey, keyView, notifyKeyOwner, permissionsFor, revokeKey, signedInOnly } from './apiKeys'
import { issueApiKey, revokeApiKey } from './apiKeyIssuer'
import { getRecord, queryItemFromIndex } from './db'
import { getUserEmail } from './cognito'
import { getEmailProvider } from './EmailProvider'
import { listMembers } from './merchant'

jest.mock('./apiKeyIssuer', () => ({ issueApiKey: jest.fn(), revokeApiKey: jest.fn() }))
jest.mock('./db', () => ({ getRecord: jest.fn(), queryItemFromIndex: jest.fn() }))
jest.mock('./cognito', () => ({ getUserEmail: jest.fn() }))
jest.mock('./EmailProvider', () => ({ getEmailProvider: jest.fn() }))
jest.mock('./merchant', () => ({ listMembers: jest.fn() }))

const SECRET = 'lks_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG'
const sendEmail = jest.fn()
const logged: string[] = []

const row = (extra: Record<string, any> = {}) => ({
  id: 'lk_live_0123456789abcdef',
  ownerType: 'user',
  ownerId: 'user-1',
  merchantId: 'internal-001',
  name: 'Accounting bot',
  permissions: ['accounts:read'],
  status: 'active',
  rateLimit: { perSecond: 10 },
  createdAt: '2026-10-15T10:00:00.000Z',
  createdBy: 'user-1',
  ...extra,
})

beforeEach(() => {
  process.env.BRAND_NAME = 'Loudibly'
  logged.length = 0
  for (const level of ['log', 'error'] as const) {
    jest.spyOn(console, level).mockImplementation((...args) => { logged.push(args.map(String).join(' ')) })
  }
  sendEmail.mockReset().mockResolvedValue(undefined)
  jest.mocked(getEmailProvider).mockReturnValue({ sendEmail })
  jest.mocked(getUserEmail).mockResolvedValue('owner@example.com')
  jest.mocked(listMembers).mockResolvedValue({ success: true, res: [] })
  jest.mocked(queryItemFromIndex).mockResolvedValue({ success: true, res: [] } as any)
  jest.mocked(issueApiKey).mockReset().mockResolvedValue({ ok: true, keyId: row().id, secret: SECRET, key: row() as any })
  jest.mocked(revokeApiKey).mockReset().mockResolvedValue({ ok: true, keyId: row().id, alreadyRevoked: false })
  jest.mocked(getRecord).mockResolvedValue({ success: true, res: row({ status: 'revoked' }) })
})
afterEach(() => {
  jest.restoreAllMocks()
  delete process.env.API_KEY_DEFAULT_RPS
  delete process.env.BRAND_NAME
})

const create = (extra: Record<string, any> = {}) => createKey({
  ownerType: 'user', ownerId: 'user-1', merchantId: 'internal-001', name: ' Accounting bot ', permissions: ['accounts:read'], createdBy: 'user-1', ...extra,
})
const codeOf = (res: { statusCode: number, body: string }) => [res.statusCode, JSON.parse(res.body).error_code]

// docs/public-api-plan.md step 2.6
describe('createKey', () => {
  it('asks the issuer, answers the key and its secret once, and tells the owner without it', async () => {
    process.env.API_KEY_DEFAULT_RPS = '25'
    const res = await create({ ipAllowlist: ['2001:DB8::1', '203.0.113.7', '2001:db8::1'], expiresAt: '2027-01-01T00:00:00Z' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toMatchObject({ success: true, secret: SECRET, key: { keyId: row().id, name: 'Accounting bot', status: 'active' } })
    expect(issueApiKey).toHaveBeenCalledWith({
      ownerType: 'user',
      ownerId: 'user-1',
      merchantId: 'internal-001',
      name: 'Accounting bot',
      permissions: ['accounts:read'],
      perSecond: 25,
      ipAllowlist: ['2001:db8::1', '203.0.113.7'],
      expiresAt: '2027-01-01T00:00:00Z',
      createdBy: 'user-1',
    })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(sendEmail.mock.calls)).not.toContain(SECRET)
    expect(logged.join('\n')).not.toContain(SECRET)
  })

  it('sends no allowlist when none was given, or an empty one', async () => {
    await create({ ipAllowlist: [] })
    expect(jest.mocked(issueApiKey).mock.calls[0][0]).not.toHaveProperty('ipAllowlist')
  })

  it.each([
    ['an unknown permission', { permissions: ['accounts:read', 'accounts:delete'] }, [400, 100058]],
    ['a merchant\'s permission on a user\'s key', { permissions: ['users:create'] }, [400, 100058]],
    ['a user\'s permission on a merchant\'s key', { ownerType: 'merchant', ownerId: 'acme', merchantId: 'acme' }, [400, 100058]],
    ['a range in the allowlist', { ipAllowlist: ['203.0.113.0/24'] }, [400, 100062]],
    ['21 addresses', { ipAllowlist: Array.from({ length: 21 }, (_, i) => `203.0.113.${i + 1}`) }, [400, 100062]],
  ])('refuses %s, creating nothing', async (_, extra, expected) => {
    expect(codeOf(await create(extra))).toEqual(expected)
    expect(issueApiKey).not.toHaveBeenCalled()
  })

  it('refuses an 11th usable key; revoked and expired ones do not count', async () => {
    const usable = Array.from({ length: 10 }, (_, i) => row({ id: `k${i}` }))
    jest.mocked(queryItemFromIndex).mockResolvedValue({ success: true, res: usable } as any)
    expect(codeOf(await create())).toEqual([400, 100054])
    expect(issueApiKey).not.toHaveBeenCalled()

    const nine = [...usable.slice(1), row({ id: 'r', status: 'revoked' }), row({ id: 'e', expiresAt: '2020-01-01T00:00:00Z' })]
    jest.mocked(queryItemFromIndex).mockResolvedValue({ success: true, res: nine } as any)
    expect((await create()).statusCode).toBe(200)
  })

  it('says the key may exist when the issuer could not be reached', async () => {
    jest.mocked(issueApiKey).mockRejectedValue(new Error('timeout'))
    const res = await create()
    expect(codeOf(res)).toEqual([500, 100002])
    expect(JSON.parse(res.body).message).toContain('may or may not have been created')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('answers the field the issuer refused, and 500 when it failed', async () => {
    jest.mocked(issueApiKey).mockResolvedValue({ ok: false, error: 'invalid', field: 'expiresAt' })
    expect(codeOf(await create())).toEqual([400, 100031])
    jest.mocked(issueApiKey).mockResolvedValue({ ok: false, error: 'failed' })
    expect(codeOf(await create())).toEqual([500, 100002])
  })

  it('answers the key even when the owner cannot be told', async () => {
    sendEmail.mockRejectedValue(new Error('SES down'))
    expect((await create()).statusCode).toBe(200)
    expect(logged.join('\n')).toContain('Could not tell the owner')
  })
})

describe('revokeKey', () => {
  it('revokes and tells the owner, naming staff and their reason', async () => {
    const res = await revokeKey({ keyId: row().id, revokedBy: 'staff-1', reason: 'leaked in a log' })
    expect(JSON.parse(res.body)).toEqual({ success: true, keyId: row().id, status: 'revoked' })
    const [, subject, text] = sendEmail.mock.calls[0]
    expect(subject).toContain('revoked')
    expect(text).toContain('staff')
    expect(text).toContain('Reason: leaked in a log')
  })

  it('tells the owner it was them when they revoked it', async () => {
    await revokeKey({ keyId: row().id, revokedBy: 'user-1', ownerId: 'user-1' })
    expect(sendEmail.mock.calls[0][2]).toContain('By: you')
  })

  it('tells nobody again when the key was revoked already', async () => {
    jest.mocked(revokeApiKey).mockResolvedValue({ ok: true, keyId: row().id, alreadyRevoked: true })
    expect((await revokeKey({ keyId: row().id, revokedBy: 'user-1', ownerId: 'user-1' })).statusCode).toBe(200)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('answers 404 100060 for a key that is not there or not the caller\'s', async () => {
    jest.mocked(revokeApiKey).mockResolvedValue({ ok: false, error: 'not_found' })
    expect(codeOf(await revokeKey({ keyId: row().id, revokedBy: 'user-2', ownerId: 'user-2' }))).toEqual([404, 100060])
  })

  it('says the key may be revoked when the issuer could not be reached', async () => {
    jest.mocked(revokeApiKey).mockRejectedValue(new Error('timeout'))
    expect(codeOf(await revokeKey({ keyId: row().id, revokedBy: 'u' }))).toEqual([500, 100002])
  })
})

describe('notifyKeyOwner', () => {
  it('writes to a merchant\'s active team only', async () => {
    jest.mocked(listMembers).mockResolvedValue({
      success: true,
      res: [
        { sk: 'MEMBER#a', status: 'active', email: 'a@acme.test' },
        { sk: 'MEMBER#b', status: 'removed', email: 'b@acme.test' },
        { sk: 'MEMBER#c', status: 'active', email: 'c@acme.test' },
      ],
    })
    await notifyKeyOwner(row({ ownerType: 'merchant', ownerId: 'acme' }) as any, 'created', { staff: true })
    expect(sendEmail.mock.calls.map(([to]) => to)).toEqual(['a@acme.test', 'c@acme.test'])
  })

  it('sends nothing when nobody can be told', async () => {
    jest.mocked(getUserEmail).mockResolvedValue(null)
    await notifyKeyOwner(row() as any, 'created', { staff: false })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('escapes the key name in the html', async () => {
    await notifyKeyOwner(row({ name: '<a href="x">bot</a>' }) as any, 'created', { staff: false })
    expect(sendEmail.mock.calls[0][3]).toContain('&lt;a href=&quot;x&quot;&gt;bot&lt;/a&gt;')
  })
})

describe('signedInOnly', () => {
  it('takes a signed-in session only: 100057 for a key or an HMAC signature', () => {
    expect(signedInOnly({ userId: 'u', authType: 'jwt' })).toEqual({ userId: 'u' })
    for (const authType of ['apikey', 'key', undefined]) {
      expect(codeOf(signedInOnly({ userId: 'u', authType }).error!)).toEqual([403, 100057])
    }
  })
})

describe('the rest', () => {
  it('shows a key without anything the row should not have', () => {
    const view = keyView({ ...row(), secret: 'x', hash: 'y' })
    expect(view).not.toHaveProperty('secret')
    expect(view).not.toHaveProperty('hash')
    expect(view).toMatchObject({ keyId: row().id, ipAllowlist: [], lastUsedAt: null })
  })

  it('offers each kind of owner its own permissions', () => {
    const names = (owner: 'user' | 'merchant') => permissionsFor(owner).map(p => p.name)
    expect(names('user')).toContain('withdrawals:create')
    expect(names('user')).not.toContain('users:create')
    expect(names('merchant')).toEqual(['users:create', 'users:invite', 'users:read'])
  })

  it('drops duplicate permissions and addresses', () => {
    expect(checkPermissions(['accounts:read', 'accounts:read'], 'user')).toEqual({ permissions: ['accounts:read'] })
    expect(checkAllowlist(['203.0.113.7', '203.0.113.7'])).toEqual({ ips: ['203.0.113.7'] })
    expect(checkAllowlist(undefined)).toEqual({ ips: undefined })
  })
})
