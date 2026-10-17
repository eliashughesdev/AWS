import AccountsListHandler from './list'
import { getRecord, queryRecord } from '../../../utils/db'

jest.mock('../../../utils/db', () => ({ queryRecord: jest.fn(), getRecord: jest.fn() }))

const row = (accountNo: string, name?: string) => ({
  id: 'user-1',
  sk: `ACCOUNT#${accountNo}`,
  accountNo,
  vAccountId: `va-${accountNo}`,
  chain: 'TRON',
  ...(name ? { name } : {}),
})

describe('GET /accounts/list', () => {
  it('answers each account\'s name, and its number for one that has none', async () => {
    jest.mocked(queryRecord).mockResolvedValue({ success: true, res: [row('PCF0001a', 'Savings'), row('PCF0001b')] })
    jest.mocked(getRecord).mockResolvedValue({ success: true, res: { balance: 5, availableBalance: 5 } })

    const res = await new AccountsListHandler().execute({ requestContext: { authorizer: { userId: 'user-1', authType: 'jwt' } } }, {} as any)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).accounts).toMatchObject([
      { accountNo: 'PCF0001a', name: 'Savings' },
      { accountNo: 'PCF0001b', name: 'PCF0001b' },
    ])
  })

  // docs/public-api-plan.md D11: the apps say before submitting that the user must verify
  it('answers which operations need KYC in each account\'s currency, by its merchant\'s policy', async () => {
    jest.mocked(queryRecord).mockImplementation(async (table: string | undefined) => (table === 'v1MerchantTable'
      ? { success: true, res: [{ id: 'mrc_1', sk: 'POLICY#KYC', 'TRON#withdraw': false }] }
      : { success: true, res: [{ ...row('PCF0001a'), merchantId: 'mrc_1' }, { ...row('PCF0001b'), merchantId: 'mrc_1', chain: 'SOL' }] }) as any)
    jest.mocked(getRecord).mockResolvedValue({ success: true, res: { balance: 5, availableBalance: 5 } })

    const res = await new AccountsListHandler().execute({ requestContext: { authorizer: { userId: 'user-1', authType: 'jwt' } } }, {} as any)

    expect(JSON.parse(res.body).accounts.map((a: any) => a.kycRequired)).toEqual([
      { withdraw: false, transfer: true, cardDeposit: true },
      { withdraw: true, transfer: true, cardDeposit: true },
    ])
    // Once for the two accounts' one merchant
    expect(jest.mocked(queryRecord).mock.calls.filter(([table]) => table === 'v1MerchantTable')).toHaveLength(1)
  })

  it('answers KYC as required when the policy cannot be read, and still lists the accounts', async () => {
    jest.mocked(queryRecord).mockImplementation(async (table: string | undefined) => (table === 'v1MerchantTable'
      ? { success: false, res: null }
      : { success: true, res: [{ ...row('PCF0001a'), merchantId: 'mrc_1' }] }) as any)
    jest.mocked(getRecord).mockResolvedValue({ success: true, res: { balance: 5, availableBalance: 5 } })

    const res = await new AccountsListHandler().execute({ requestContext: { authorizer: { userId: 'user-1', authType: 'jwt' } } }, {} as any)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).accounts[0].kycRequired).toEqual({ withdraw: true, transfer: true, cardDeposit: true })
  })
})
