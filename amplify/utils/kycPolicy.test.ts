import { checkKyc, isKycApproved, kycPolicyOf, kycRequiredBy, readKycPolicy } from './kycPolicy'
import { queryRecord } from './db'

jest.mock('./db', () => ({ queryRecord: jest.fn() }))

// docs/public-api-plan.md D11: one switch per merchant, currency and operation; unset requires KYC
const policyRow = { id: 'mrc_1', sk: 'POLICY#KYC', 'USDT_TRON#withdraw': false, 'USDT_TRON#transfer': true }

// queryRecord answers the policy row for v1MerchantTable and the profile for v2CustomerTable
const tables = (policy: Record<string, unknown> | null, profile: Record<string, unknown> | null) =>
  jest.mocked(queryRecord).mockImplementation(async (table: string | undefined) => ({
    success: true,
    res: table === 'v1MerchantTable' ? (policy ? [policy] : []) : (profile ? [profile] : []),
  }) as any)

const approved = { id: 'user-1', sk: 'USERPROFILE', kyc: { status: 'Approved' } }
const check = (operation: 'withdraw' | 'transfer' | 'cardDeposit', currency = 'USDT_TRON') =>
  checkKyc({ userId: 'user-1', merchantId: 'mrc_1', currency, operation })
const codeOf = async (res: Promise<any>) => {
  const r = await res
  return r && [r.statusCode, JSON.parse(r.body).error_code]
}

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}))
afterEach(() => jest.restoreAllMocks())

describe('kycRequiredBy', () => {
  it('turns KYC off only for a switch set to false', () => {
    expect(kycRequiredBy(policyRow, 'USDT_TRON', 'withdraw')).toBe(false)
    expect(kycRequiredBy(policyRow, 'usdt_tron', 'withdraw')).toBe(false)
    expect(kycRequiredBy(policyRow, 'USDT_TRON', 'transfer')).toBe(true)
    expect(kycRequiredBy(policyRow, 'USDT_TRON', 'cardDeposit')).toBe(true)
    expect(kycRequiredBy(policyRow, 'SOL', 'withdraw')).toBe(true)
    expect(kycRequiredBy(null, 'SOL', 'withdraw')).toBe(true)
    expect(kycRequiredBy({ 'SOL#withdraw': 'false' }, 'SOL', 'withdraw')).toBe(true)
  })

  it('answers every ledger currency in a policy', () => {
    expect(Object.keys(kycPolicyOf(null)).sort()).toEqual(['SOL', 'TRON', 'TUSDT_TRON', 'USDT_TRON'])
    expect(kycPolicyOf(policyRow).USDT_TRON).toEqual({ withdraw: false, transfer: true, cardDeposit: true })
  })
})

describe('isKycApproved', () => {
  it('takes only Didit\'s Approved', () => {
    expect(isKycApproved(approved)).toBe(true)
    for (const status of ['Not Started', 'In Review', 'Declined', 'approved', undefined]) {
      expect(isKycApproved({ kyc: { status } })).toBe(false)
    }
    expect(isKycApproved({})).toBe(false)
    expect(isKycApproved(undefined)).toBe(false)
  })
})

describe('checkKyc', () => {
  it('lets an operation the policy does not gate through without reading the profile', async () => {
    tables(policyRow, null)
    expect(await check('withdraw')).toBeUndefined()
    expect(queryRecord).toHaveBeenCalledTimes(1)
  })

  it('lets a verified user through where KYC is required', async () => {
    tables(policyRow, approved)
    expect(await check('transfer')).toBeUndefined()
  })

  it.each([
    ['set to true', 'transfer', 'USDT_TRON'],
    ['never set', 'cardDeposit', 'USDT_TRON'],
    ['in a currency the policy does not name', 'withdraw', 'SOL'],
  ] as const)('refuses an unverified user with 100059 where the switch is %s', async (_, operation, currency) => {
    tables(policyRow, { id: 'user-1', sk: 'USERPROFILE', kyc: { status: 'In Review' } })
    expect(await codeOf(check(operation, currency))).toEqual([403, 100059])
  })

  it('refuses where the merchant has no policy at all, or the user no profile', async () => {
    tables(null, null)
    expect(await codeOf(check('withdraw'))).toEqual([403, 100059])
  })

  it('refuses for an account with no merchant', async () => {
    tables(null, null)
    const res = await checkKyc({ userId: 'user-1', merchantId: undefined, currency: 'TRON', operation: 'withdraw' })
    expect(JSON.parse(res!.body).error_code).toBe(100059)
  })

  it('names the operations and the currency', async () => {
    tables(null, null)
    const res = await check('cardDeposit', 'usdt_tron')
    expect(JSON.parse(res!.body).message).toBe('card deposits in USDT_TRON need a verified identity')
  })

  it('never lets an operation through when the policy or the profile cannot be read', async () => {
    jest.mocked(queryRecord).mockResolvedValue({ success: false, res: null } as any)
    expect(await codeOf(check('withdraw'))).toEqual([500, 100002])

    jest.mocked(queryRecord).mockImplementation(async (table: string | undefined) =>
      (table === 'v1MerchantTable' ? { success: true, res: [] } : { success: false, res: null }) as any)
    expect(await codeOf(check('withdraw'))).toEqual([500, 100002])
  })
})

describe('readKycPolicy', () => {
  it('reads nothing for no merchant', async () => {
    expect(await readKycPolicy(undefined)).toBeNull()
    expect(queryRecord).not.toHaveBeenCalled()
  })
})
