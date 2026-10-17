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
  delete accounts[sender].merchantId
  delete accounts[recipient].merchantId
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

  // Regression: a transfer moved only the ledger, so the coins stayed in the sender's merchant's
  // master while the recipient's merchant's master paid the withdrawal
  it('answers a recipient of another merchant as not found, with 100001', async () => {
    accounts[sender].merchantId = 'acme'
    accounts[recipient].merchantId = 'internal-001'
    const res = await transfer({})
    const missing = await transfer({ recipientAccountNumber: 'PCF0001ffffffffffffffffffffffffffffffff' })
    expect(JSON.parse(res.body)).toEqual(JSON.parse(missing.body))
    expect(errorCode(res)).toBe(100001)
    expectNothingMoved()
  })

  // D11: 100052 would tell the caller the account exists
  it('answers 100001, not 100052, for another merchant\'s account in another coin', async () => {
    accounts[sender].merchantId = 'acme'
    accounts[recipient].chain = 'SOL'
    expect(errorCode(await transfer({}))).toBe(100001)
    expectNothingMoved()
  })

  // `loudibly` was the system merchant before 2026-10-06 and keeps its own master
  it('keeps the pre-rename loudibly apart from internal-001', async () => {
    accounts[sender].merchantId = 'loudibly'
    accounts[recipient].merchantId = 'internal-001'
    expect(errorCode(await transfer({}))).toBe(100001)
    expectNothingMoved()
  })

  it('counts an account with no merchant as internal-001\'s', async () => {
    accounts[recipient].merchantId = 'internal-001'
    expect((await transfer({})).statusCode).toBe(200)

    accounts[recipient].merchantId = 'acme'
    expect(errorCode(await transfer({}))).toBe(100001)
  })

  // Found live on staging, 2026-10-15: a 1 TRX transfer from an empty account answered a bare 500
  it('answers 100002 when the ledger refuses, writing nothing', async () => {
    transferFunds.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 403'), { response: { status: 403 } }))
    const res = await transfer({})
    expect([res.statusCode, errorCode(res)]).toEqual([400, 100002])
    expect(JSON.parse(res.body).message).toBe('Failed to transfer funds')
    expect(putItem).not.toHaveBeenCalled()
    expect(updateItem).not.toHaveBeenCalled()
  })

  it('moves funds between two accounts of the same merchant', async () => {
    accounts[sender].merchantId = 'acme'
    accounts[recipient].merchantId = 'acme'
    expect((await transfer({})).statusCode).toBe(200)
    expect(transferFunds).toHaveBeenCalledTimes(1)
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
    // Both of one merchant: a transfer between merchants is refused before the policy is asked
    accounts[sender].merchantId = accounts[recipient].merchantId = 'mrc_1'
    await transfer({})
    delete accounts[sender].merchantId
    delete accounts[recipient].merchantId
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
