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

    const res = await new AccountsListHandler().execute({ requestContext: { authorizer: { userId: 'user-1' } } }, {} as any)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).accounts).toMatchObject([
      { accountNo: 'PCF0001a', name: 'Savings' },
      { accountNo: 'PCF0001b', name: 'PCF0001b' },
    ])
  })
})
