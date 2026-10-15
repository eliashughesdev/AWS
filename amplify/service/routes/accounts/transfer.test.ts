import TransferFundsHandler from './transfer'
import { putItem, queryItemFromIndex, updateItem } from '../../../utils/db'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { checkKyc } from '../../../utils/kycPolicy'

jest.mock('../../../utils/db', () => ({
  queryItemFromIndex: jest.fn(),
  putItem: jest.fn(async () => ({ success: true })),
  updateItem: jest.fn(async () => ({ success: true })),
}))
jest.mock('../../../utils/AccountProvider', () => ({ ProviderRegistry: { getProvider: jest.fn() } }))
// The policy itself is tested in utils/kycPolicy.test.ts; here it allows unless a test says not
jest.mock('../../../utils/kycPolicy', () => ({ checkKyc: jest.fn() }))
beforeEach(() => jest.mocked(checkKyc).mockResolvedValue(undefined))

const sender = 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4'
const recipient = 'PCF0001a1b2c3d4e5f60718293a4b5c6d7e8f90'

// Account rows as v2CustomerTable holds them; currency is the accounting currency, chain the coin
const accounts: Record<string, Record<string, any>> = {
  [sender]: { id: 'user-1', vAccountId: 'va-sender', chain: 'USDT_TRON', currency: 'USD' },
  [recipient]: { id: 'user-2', vAccountId: 'va-recipient', chain: 'USDT_TRON', currency: 'USD' },
}

const transferFunds = jest.fn(async () => ({ reference: 'tatum-ref-1' }))

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  ;(ProviderRegistry.getProvider as jest.Mock).mockReturnValue({ transferFunds })
  ;(queryItemFromIndex as jest.Mock).mockImplementation(async ({ attributeValues }) => {
    const row = accounts[attributeValues[':accountNumber'].replace('ACCOUNT#', '')]
    return { success: true, res: row ? [row] : [] }
  })
})
afterEach(() => {
  jest.restoreAllMocks()
  accounts[recipient].chain = 'USDT_TRON'
})

const transfer = (body: Record<string, string>) => new TransferFundsHandler().execute({
  requestContext: { authorizer: { userId: 'user-1', authType: 'jwt' } },
  body: { provider: 'PCF0001', senderAccountNumber: sender, recipientAccountNumber: recipient, amount: '12.5', ...body },
}, {} as any)

const errorCode = (res: { body: string }) => JSON.parse(res.body).error_code

const expectNothingMoved = () => {
  expect(transferFunds).not.toHaveBeenCalled()
  expect(putItem).not.toHaveBeenCalled()
  expect(updateItem).not.toHaveBeenCalled()
}

describe('/accounts/transfer handler', () => {
  it('moves funds between two accounts of the same currency', async () => {
    const res = await transfer({})
    expect(res.statusCode).toBe(200)
    expect(transferFunds).toHaveBeenCalledWith({ senderAccountId: 'va-sender', recipientAccountId: 'va-recipient', amount: '12.5' })
    expect(updateItem).toHaveBeenCalledTimes(2)
  })

  it('refuses a transfer to the same account with 100051, before any lookup', async () => {
    const res = await transfer({ recipientAccountNumber: sender })
    expect(errorCode(res)).toBe(100051)
    expect(queryItemFromIndex).not.toHaveBeenCalled()
    expectNothingMoved()
  })

  it('refuses a recipient holding another currency with 100052', async () => {
    accounts[recipient].chain = 'SOL'
    const res = await transfer({})
    expect(errorCode(res)).toBe(100052)
    expect(JSON.parse(res.body).message).toBe('the recipient account does not hold USDT_TRON')
    expectNothingMoved()
  })

  // Regression: comparing currency would have passed these, both being USD
  it('compares the coin, not the accounting currency', async () => {
    accounts[recipient].chain = 'TRON'
    expect(errorCode(await transfer({}))).toBe(100052)
    expectNothingMoved()
  })

  it('refuses when the sender names no coin', async () => {
    const chain = accounts[sender].chain
    delete accounts[sender].chain
    try {
      expect(errorCode(await transfer({}))).toBe(100052)
      expectNothingMoved()
    } finally {
      accounts[sender].chain = chain
    }
  })

  it('still refuses a sender that is not the user\'s with 100001', async () => {
    const res = await new TransferFundsHandler().execute({
      requestContext: { authorizer: { userId: 'someone-else', authType: 'jwt' } },
      body: { provider: 'PCF0001', senderAccountNumber: sender, recipientAccountNumber: recipient, amount: '1' },
    }, {} as any)
    expect(errorCode(res)).toBe(100001)
    expectNothingMoved()
  })
})

// docs/public-api-plan.md D11
describe('/accounts/transfer KYC policy', () => {
  it('asks the sender\'s merchant\'s policy for transfers in the currency', async () => {
    accounts[sender].merchantId = 'mrc_1'
    await transfer({})
    delete accounts[sender].merchantId
    expect(checkKyc).toHaveBeenCalledWith({ userId: 'user-1', merchantId: 'mrc_1', currency: 'USDT_TRON', operation: 'transfer' })
  })

  it('answers the refusal and moves nothing', async () => {
    jest.mocked(checkKyc).mockResolvedValue({ statusCode: 403, headers: {}, body: JSON.stringify({ error_code: 100059, message: 'x' }) } as any)
    const res = await transfer({})
    expect(res.statusCode).toBe(403)
    expect(errorCode(res)).toBe(100059)
    expectNothingMoved()
  })
})
