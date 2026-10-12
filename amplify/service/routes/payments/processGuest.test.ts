import ProcessGuestPaymentHandler from './processGuest'
import { sendToQueue } from '../../../utils/sqs'

jest.mock('../../../utils/sqs', () => ({ sendToQueue: jest.fn() }))

const processGuest = () => new ProcessGuestPaymentHandler().execute({
  body: { cardData: 'ev:Tk9OQ:encrypted-card', userId: 'guest-1', amount: 50, currency: 'USD', transactionId: 'txn_1' },
})

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('/payments/process/guest handler', () => {
  it('queues the payment', async () => {
    ;(sendToQueue as jest.Mock).mockResolvedValue({ success: true, res: { MessageId: 'job-1' } })
    const res = await processGuest()
    expect(res!.statusCode).toBe(200)
    expect(JSON.parse(res!.body)).toMatchObject({ jobId: 'job-1', status: 'queued' })
  })

  // B16: a refused message fell through with no answer, which API Gateway turned into a 502
  it('answers 100002 when the queue refuses the job', async () => {
    ;(sendToQueue as jest.Mock).mockResolvedValue({ success: false })
    const res = await processGuest()
    expect(res).toBeDefined()
    expect(JSON.parse(res!.body)).toEqual({ error_code: 100002, message: 'the payment could not be queued; nothing was charged' })
  })

  it('answers 100002 when queueing throws', async () => {
    ;(sendToQueue as jest.Mock).mockRejectedValue(new Error('network'))
    const res = await processGuest()
    expect(JSON.parse(res!.body).error_code).toBe(100002)
  })
})
