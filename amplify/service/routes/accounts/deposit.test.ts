import DepositHandler from './deposit'
import { queryItemFromIndex } from '../../../utils/db'
import { sendToQueue } from '../../../utils/sqs'
import { fetchCryptoPrice } from '../../../utils/exchangeRate'
import { checkKyc } from '../../../utils/kycPolicy'

jest.mock('../../../utils/db', () => ({ queryItemFromIndex: jest.fn() }))
jest.mock('../../../utils/sqs', () => ({ sendToQueue: jest.fn() }))
jest.mock('../../../utils/exchangeRate', () => ({ fetchCryptoPrice: jest.fn() }))
// The policy itself is tested in utils/kycPolicy.test.ts; here it allows unless a test says not
jest.mock('../../../utils/kycPolicy', () => ({ checkKyc: jest.fn() }))
beforeEach(() => jest.mocked(checkKyc).mockResolvedValue(undefined))

const deposit = () => new DepositHandler().execute({
  requestContext: { authorizer: { userId: 'user-1', authType: 'jwt' } },
  body: { accountNumber: 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4', currency: 'USD', amount: 50, paymentId: 'card_1', transactionId: 'dep_1' },
})

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  ;(fetchCryptoPrice as jest.Mock).mockResolvedValue(0.25)
  ;(queryItemFromIndex as jest.Mock).mockResolvedValue({
    success: true,
    res: [{ id: 'user-1', vAccountId: 'va-1', chain: 'TRON', currency: 'USD' }],
  })
})
afterEach(() => jest.restoreAllMocks())

describe('/accounts/deposit handler', () => {
  it('queues the deposit', async () => {
    ;(sendToQueue as jest.Mock).mockResolvedValue({ success: true, res: { MessageId: 'job-1' } })
    const res = await deposit()
    expect(res!.statusCode).toBe(200)
    expect(JSON.parse(res!.body)).toMatchObject({ jobId: 'job-1', transactionId: 'dep_1', status: 'queued' })
    // 50 USD at 0.25 USD a TRX
    expect(JSON.parse(res!.body).res).toMatchObject({ cryptoAmount: 200, cryptoCurrency: 'TRON', exchangeRate: 0.25 })
  })

  // Regression: a failed lookup escaped the handler as a bare 500
  it('answers 100002 without queueing when the exchange rate cannot be read', async () => {
    ;(fetchCryptoPrice as jest.Mock).mockRejectedValue(new Error('EXCHANGE_RATE: Price not available for TRXEUR'))
    const res = await deposit()
    expect(JSON.parse(res!.body)).toEqual({ error_code: 100002, message: 'no TRON price in USD could be read; nothing was charged' })
    expect(sendToQueue).not.toHaveBeenCalled()
  })

  it.each([0, Number.NaN, -1])('answers 100002 without queueing for a rate of %p', async rate => {
    ;(fetchCryptoPrice as jest.Mock).mockResolvedValue(rate)
    const res = await deposit()
    expect(JSON.parse(res!.body).error_code).toBe(100002)
    expect(sendToQueue).not.toHaveBeenCalled()
  })

  // Regression: a refused message fell through with no answer, which API Gateway turned into a 502
  it('answers 100002 when the queue refuses the job', async () => {
    ;(sendToQueue as jest.Mock).mockResolvedValue({ success: false })
    const res = await deposit()
    expect(res).toBeDefined()
    expect(JSON.parse(res!.body)).toEqual({ error_code: 100002, message: 'the deposit could not be queued; nothing was charged' })
  })

  // Regression: this answered 100029, the code for a missing parameter
  it('answers 100002 when queueing throws', async () => {
    ;(sendToQueue as jest.Mock).mockRejectedValue(new Error('network'))
    const res = await deposit()
    expect(JSON.parse(res!.body).error_code).toBe(100002)
  })
})

// docs/public-api-plan.md D11
describe('/accounts/deposit KYC policy', () => {
  it('asks the policy for card deposits in the account\'s currency', async () => {
    ;(sendToQueue as jest.Mock).mockResolvedValue({ success: true, res: { MessageId: 'job-1' } })
    await deposit()
    expect(checkKyc).toHaveBeenCalledWith({ userId: 'user-1', merchantId: undefined, currency: 'TRON', operation: 'cardDeposit' })
  })

  it('answers the refusal and queues no charge', async () => {
    jest.mocked(checkKyc).mockResolvedValue({ statusCode: 403, headers: {}, body: JSON.stringify({ error_code: 100059, message: 'x' }) } as any)
    const res = await deposit()
    expect(res!.statusCode).toBe(403)
    expect(JSON.parse(res!.body).error_code).toBe(100059)
    expect(sendToQueue).not.toHaveBeenCalled()
  })
})
