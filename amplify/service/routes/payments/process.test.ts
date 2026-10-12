import ProcessPaymentHandler from './process'
import { sendToQueue } from '../../../utils/sqs'

jest.mock('../../../utils/sqs', () => ({ sendToQueue: jest.fn() }))

const body = { paymentId: 'card_1', amount: 50, currency: 'USD', transactionId: 'txn_1' }
const process = (authorizer: Record<string, string>, extra: Record<string, unknown> = {}) =>
  new ProcessPaymentHandler().execute({ requestContext: { authorizer }, body: { ...body, ...extra } })

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  ;(sendToQueue as jest.Mock).mockResolvedValue({ success: true, res: { MessageId: 'job-1' } })
})
afterEach(() => jest.restoreAllMocks())

describe('/payments/process handler', () => {
  // The schema no longer requires userId: a signed-in user need not send it
  it('queues a signed-in user\'s payment as that user, whatever userId the body names', async () => {
    const res = await process({ role: 'user', userId: 'user-1' }, { userId: 'someone-else' })
    expect(res!.statusCode).toBe(200)
    expect((sendToQueue as jest.Mock).mock.calls[0][1]).toMatchObject({ userId: 'user-1', paymentId: 'card_1' })
  })

  it('queues a platform key\'s payment for the user the body names', async () => {
    await process({ role: 'admin' }, { userId: 'user-2' })
    expect((sendToQueue as jest.Mock).mock.calls[0][1]).toMatchObject({ userId: 'user-2' })
  })

  it('answers 100029 without queueing when a platform key names no user', async () => {
    const res = await process({ role: 'admin' })
    expect(JSON.parse(res!.body).error_code).toBe(100029)
    expect(sendToQueue).not.toHaveBeenCalled()
  })

  // B16: a refused message fell through with no answer, which API Gateway turned into a 502
  it('answers 100002 when the queue refuses the job', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(sendToQueue as jest.Mock).mockResolvedValue({ success: false })
    const res = await process({ role: 'user', userId: 'user-1' })
    expect(res).toBeDefined()
    expect(JSON.parse(res!.body)).toEqual({ error_code: 100002, message: 'the payment could not be queued; nothing was charged' })
  })

  it('answers 100002 when queueing throws', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(sendToQueue as jest.Mock).mockRejectedValue(new Error('network'))
    const res = await process({ role: 'user', userId: 'user-1' })
    expect(JSON.parse(res!.body).error_code).toBe(100002)
  })

  it('queues no field the handler does not list (B1)', async () => {
    await process({ role: 'user', userId: 'user-1' }, { queue: 'v1-sweep-queue', kmsKeyId: 'k' })
    const message = (sendToQueue as jest.Mock).mock.calls[0][1]
    expect(message.queue).toBe('v1-payment-processing-queue')
    expect(message).not.toHaveProperty('kmsKeyId')
  })
})
