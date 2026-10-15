import SetKycPolicyHandler from './policy-kyc'
import { queryRecord, updateItem } from '../../../utils/db'
import { getMerchant } from '../../../utils/merchant'

jest.mock('../../../utils/db', () => ({ queryRecord: jest.fn(), updateItem: jest.fn() }))
jest.mock('../../../utils/merchant', () => ({ getMerchant: jest.fn() }))

const set = (body: Record<string, unknown>) => new SetKycPolicyHandler().execute({
  requestContext: { authorizer: { userId: 'staff-1' } },
  body: { merchantId: 'internal-001', currency: 'USDT_TRON', ...body } as any,
}, {} as any)

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.mocked(getMerchant).mockResolvedValue({ success: true, res: { id: 'internal-001', status: 'active' } })
  jest.mocked(updateItem).mockResolvedValue({ success: true, res: {}, error: null } as any)
  jest.mocked(queryRecord).mockResolvedValue({ success: true, res: [{ 'USDT_TRON#withdraw': false }] } as any)
})
afterEach(() => jest.restoreAllMocks())

// docs/public-api-plan.md D11
describe('POST /merchants/policy/kyc', () => {
  it('writes only the switches sent, each as its own attribute, with who changed it', async () => {
    await set({ withdraw: false, cardDeposit: true })
    const call = jest.mocked(updateItem).mock.calls[0][0]
    expect(call.key).toEqual({ id: 'internal-001', sk: 'POLICY#KYC' })
    expect(call.updateExpression).toBe('SET #s0 = :s0, #s1 = :s1, updatedAt = :now, updatedBy = :by')
    expect(call.attributeNames).toEqual({ '#s0': 'USDT_TRON#withdraw', '#s1': 'USDT_TRON#cardDeposit' })
    expect(call.attributeValues).toMatchObject({ ':s0': false, ':s1': true, ':by': 'staff-1' })
  })

  it('answers the currency\'s switches as they now stand, unset ones as required', async () => {
    const res = await set({ withdraw: false })
    expect(JSON.parse(res.body)).toEqual({
      success: true,
      merchantId: 'internal-001',
      currency: 'USDT_TRON',
      kycRequired: { withdraw: false, transfer: true, cardDeposit: true },
    })
  })

  it('refuses a merchant that does not exist with 100040, writing nothing', async () => {
    jest.mocked(getMerchant).mockResolvedValue({ success: true, res: null })
    const res = await set({ withdraw: false })
    expect(JSON.parse(res.body).error_code).toBe(100040)
    expect(updateItem).not.toHaveBeenCalled()
  })

  it('answers 100003 when the write fails', async () => {
    jest.mocked(updateItem).mockResolvedValue({ success: false, res: null, error: new Error('x') } as any)
    expect(JSON.parse((await set({ transfer: true })).body).error_code).toBe(100003)
  })
})
