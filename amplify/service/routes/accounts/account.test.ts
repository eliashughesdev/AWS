import AccountHandler from './account'
import { queryRecord, transactWriteItems } from '../../../utils/db'
import { provisionCustodialAccount } from '../../../utils/custodialAccount'

jest.mock('../../../utils/db', () => ({ queryRecord: jest.fn(), transactWriteItems: jest.fn() }))
jest.mock('../../../utils/masterAccount', () => ({ canHoldCurrency: async () => true }))
jest.mock('../../../utils/custodialAccount', () => ({
  provisionCustodialAccount: jest.fn(),
  discardProvisionedAccount: jest.fn(),
}))
const mockProvision = jest.mocked(provisionCustodialAccount)
const mockWrite = jest.mocked(transactWriteItems)

const open = (accountName?: string) => new AccountHandler().execute({
  body: { chain: 'TRON', provider: 'PCF0001', accountingCurrency: 'USD', accountName },
  requestContext: { authorizer: { userId: 'user-1', authType: 'jwt' } },
}, {} as any)

describe('POST /accounts/account account name', () => {
  beforeEach(() => {
    // A user with no profile yet: this account is their first
    jest.mocked(queryRecord).mockResolvedValue({ success: true, res: [] })
    mockProvision.mockResolvedValue({
      accountNo: 'PCF0001a',
      depositAddress: 'TAddress',
      vAccountId: 'va-1',
      subscriptionId: 'sub-1',
      accountRecord: { id: 'user-1', sk: 'ACCOUNT#PCF0001a' },
      balanceRecord: { id: 'va-1' },
    })
    mockWrite.mockResolvedValue({ success: true, res: {} as any, error: null })
  })

  it('names the account with accountName', async () => {
    expect((await open('Savings')).statusCode).toBe(200)
    expect(mockProvision).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', name: 'Savings' }))
  })

  // accountName used to be written as the person's name on the profile a first account creates
  it('creates the profile of a first account without a name', async () => {
    await open('Savings')
    const profile = mockWrite.mock.calls[0][0].puts.find(put => put.item.sk === 'USERPROFILE')!.item
    expect(profile.id).toBe('user-1')
    expect(profile).not.toHaveProperty('name')
  })

  it('opens an account when no accountName is sent', async () => {
    expect((await open()).statusCode).toBe(200)
    expect(mockProvision.mock.calls[0][0].name).toBeUndefined()
  })
})
