import DetailsHandler from './details'
import { getRecord, queryItemFromIndex } from '../../../utils/db'

jest.mock('../../../utils/db', () => ({ queryItemFromIndex: jest.fn(), getRecord: jest.fn() }))

const accountNumber = 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4'
const row = { id: 'user-1', sk: `ACCOUNT#${accountNumber}`, accountNo: accountNumber, vAccountId: 'va-1', chain: 'TRON' }

const run = (userId = 'user-1') =>
  new DetailsHandler().execute({ body: { accountNumber }, requestContext: { authorizer: { userId, authType: 'jwt' } } }, {} as any)

const details = async () => JSON.parse((await run()).body).res.data.res

describe('POST /accounts/details', () => {
  beforeEach(() => {
    jest.mocked(getRecord).mockResolvedValue({ success: true, res: { id: 'va-1', balance: 5, availableBalance: 5 } })
  })

  it('answers the account\'s name', async () => {
    jest.mocked(queryItemFromIndex).mockResolvedValue({ success: true, res: [{ ...row, name: 'Savings' }] })
    expect((await details()).name).toBe('Savings')
  })

  it('answers the account number for an account that has no name', async () => {
    jest.mocked(queryItemFromIndex).mockResolvedValue({ success: true, res: [row] })
    expect((await details()).name).toBe(accountNumber)
  })

  // It answered any account to anyone signed in (docs/public-api-plan.md, step 1.1)
  it('answers 100001 for another user\'s account, as for one that does not exist', async () => {
    jest.mocked(queryItemFromIndex).mockResolvedValue({ success: true, res: [row] })
    const res = await run('someone-else')
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error_code).toBe(100001)
    expect(getRecord).not.toHaveBeenCalled()
  })

  it('answers 100001 for an account that does not exist', async () => {
    jest.mocked(queryItemFromIndex).mockResolvedValue({ success: true, res: [] })
    expect(JSON.parse((await run()).body).error_code).toBe(100001)
  })
})
