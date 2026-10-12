import DetailsHandler from './details'
import { getRecord, queryItemFromIndex } from '../../../utils/db'

jest.mock('../../../utils/db', () => ({ queryItemFromIndex: jest.fn(), getRecord: jest.fn() }))

const accountNumber = 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4'
const row = { id: 'user-1', sk: `ACCOUNT#${accountNumber}`, accountNo: accountNumber, vAccountId: 'va-1', chain: 'TRON' }

const details = async () => {
  const res = await new DetailsHandler().execute({ body: { accountNumber } }, {} as any)
  return JSON.parse(res.body).res.data.res
}

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
})
