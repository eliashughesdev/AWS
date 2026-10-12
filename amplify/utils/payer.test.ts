import { resolvePayer } from './payer'
import { queryRecord } from './db'

jest.mock('./db', () => ({ queryRecord: jest.fn() }))

const user = { userId: 'user-a', role: 'user', authType: 'jwt' }
const merchantKey = { userId: 'merchant-1', role: 'admin', authType: 'key', merchantId: 'merchant-1' }
const profileOf = (merchantId: string) => ({ success: true, res: [{ id: 'user-b', sk: 'USERPROFILE', merchantId }] })
const notYours = { statusCode: 403, body: JSON.stringify({ error_code: 100053, message: 'this user is not yours to act for' }) }

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => jest.resetAllMocks())

// Regression (pci-remediation-plan.md F3): every card route took userId from the request, so
// any signed-in user could list and charge another user's cards
describe('resolvePayer', () => {
  describe('a signed-in user', () => {
    it.each([
      ['no userId', undefined],
      ['their own userId', 'user-a'],
    ])('acts for themselves when the request names %s', async (_, requested) => {
      expect(await resolvePayer(user, requested)).toEqual({ userId: 'user-a' })
      expect(queryRecord).not.toHaveBeenCalled()
    })

    it('is refused when the request names another user', async () => {
      expect((await resolvePayer(user, 'user-b')).error).toMatchObject(notYours)
    })
  })

  describe('a merchant\'s key', () => {
    it('acts for one of the merchant\'s own users', async () => {
      ;(queryRecord as jest.Mock).mockResolvedValue(profileOf('merchant-1'))
      expect(await resolvePayer(merchantKey, 'user-b')).toEqual({ userId: 'user-b' })
      expect(queryRecord).toHaveBeenCalledWith('v2CustomerTable', 'id = :id AND sk = :sk', { ':id': 'user-b', ':sk': 'USERPROFILE' })
    })

    it('is refused for another merchant\'s user', async () => {
      ;(queryRecord as jest.Mock).mockResolvedValue(profileOf('merchant-2'))
      expect((await resolvePayer(merchantKey, 'user-b')).error).toMatchObject(notYours)
    })

    // The same answer as another merchant's user, so a merchant cannot learn which ids exist
    it.each([
      ['a user that does not exist', { success: true, res: [] }],
      ['a profile with no merchant', { success: true, res: [{ id: 'user-b', sk: 'USERPROFILE' }] }],
    ])('is refused for %s', async (_, profile) => {
      ;(queryRecord as jest.Mock).mockResolvedValue(profile)
      expect((await resolvePayer(merchantKey, 'user-b')).error).toMatchObject(notYours)
    })

    it.each([undefined, ''])('answers 100029 when the request names no user (%p)', async requested => {
      const { error } = await resolvePayer(merchantKey, requested)
      expect(JSON.parse(error!.body)).toEqual({ error_code: 100029, message: 'required parameters for this request are userId' })
    })

    it('answers 100002 when the profile cannot be read', async () => {
      ;(queryRecord as jest.Mock).mockResolvedValue({ success: false })
      const { error } = await resolvePayer(merchantKey, 'user-b')
      expect(JSON.parse(error!.body).error_code).toBe(100002)
    })
  })

  describe('anyone else', () => {
    it.each([
      ['staff', { userId: 'staff-1', role: 'staff', authType: 'jwt' }],
      ['a merchant\'s team member', { userId: 'member-1', role: 'merchant', authType: 'jwt' }],
      // role admin from a Cognito group, not a key: its userId is a person, not a merchant
      ['the Cognito group admin', { userId: 'admin-1', role: 'admin', authType: 'jwt' }],
      // From an authorizer older than authType
      ['a user with no authType', { userId: 'user-a', role: 'user' }],
      ['a key with no merchantId', { userId: 'merchant-1', role: 'admin', authType: 'key' }],
      ['no authorizer', undefined],
    ])('is refused: %s', async (_, authorizer) => {
      expect((await resolvePayer(authorizer, 'user-a')).error).toMatchObject(notYours)
      expect(queryRecord).not.toHaveBeenCalled()
    })
  })
})
