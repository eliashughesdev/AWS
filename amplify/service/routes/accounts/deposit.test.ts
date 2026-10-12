import DepositHandler from './deposit'
import { queryItemFromIndex } from '../../../utils/db'
import { sendToQueue } from '../../../utils/sqs'

jest.mock('../../../utils/db', () => ({ queryItemFromIndex: jest.fn() }))
jest.mock('../../../utils/sqs', () => ({ sendToQueue: jest.fn() }))
jest.mock('../../../utils/exchangeRate', () => ({ fetchCryptoPrice: jest.fn(async () => 0.25) }))

const deposit = () => new DepositHandler().execute({
  requestContext: { authorizer: { userId: 'user-1' } },
  body: { accountNumber: 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4', currency: 'USD', amount: 50, paymentId: 'card_1', transactionId: 'dep_1' },
})

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
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
