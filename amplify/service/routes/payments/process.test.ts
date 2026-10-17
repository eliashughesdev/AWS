import ProcessPaymentHandler from './process'
import { sendToQueue } from '../../../utils/sqs'
import { queryRecord } from '../../../utils/db'

jest.mock('../../../utils/sqs', () => ({ sendToQueue: jest.fn() }))
jest.mock('../../../utils/db', () => ({ queryRecord: jest.fn() }))

const user = { userId: 'user-1', role: 'user', authType: 'jwt' }
const merchantKey = { userId: 'merchant-1', role: 'admin', authType: 'key', merchantId: 'merchant-1' }
const body = { paymentId: 'card_1', amount: 50, currency: 'USD', transactionId: 'txn_1' }
const process = (authorizer: Record<string, string>, extra: Record<string, unknown> = {}) =>
  new ProcessPaymentHandler().execute({ requestContext: { authorizer }, body: { ...body, ...extra } })

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  ;(sendToQueue as jest.Mock).mockResolvedValue({ success: true, res: { MessageId: 'job-1' } })
})
afterEach(() => jest.restoreAllMocks())

describe('/payments/process handler', () => {
  it('queues a signed-in user\'s payment as that user', async () => {
    const res = await process(user)
    expect(res!.statusCode).toBe(200)
    expect((sendToQueue as jest.Mock).mock.calls[0][1]).toMatchObject({ userId: 'user-1', paymentId: 'card_1' })
  })

  // F3: this was ignored; it is now refused so a confused client hears about it
  it('answers 100053 without queueing when a signed-in user names someone else', async () => {
    const res = await process(user, { userId: 'someone-else' })
    expect(res!.statusCode).toBe(403)
    expect(JSON.parse(res!.body).error_code).toBe(100053)
    expect(sendToQueue).not.toHaveBeenCalled()
  })

  it('queues a merchant key\'s payment for one of its own users', async () => {
    ;(queryRecord as jest.Mock).mockResolvedValue({ success: true, res: [{ merchantId: 'merchant-1' }] })
    await process(merchantKey, { userId: 'user-2' })
    expect((sendToQueue as jest.Mock).mock.calls[0][1]).toMatchObject({ userId: 'user-2' })
  })

  // F3: a merchant key could charge any merchant's user
  it('answers 100053 without queueing for another merchant\'s user', async () => {
    ;(queryRecord as jest.Mock).mockResolvedValue({ success: true, res: [{ merchantId: 'merchant-2' }] })
    const res = await process(merchantKey, { userId: 'user-2' })
    expect(JSON.parse(res!.body).error_code).toBe(100053)
    expect(sendToQueue).not.toHaveBeenCalled()
  })

  it('answers 100029 without queueing when a merchant key names no user', async () => {
    const res = await process(merchantKey)
    expect(JSON.parse(res!.body).error_code).toBe(100029)
    expect(sendToQueue).not.toHaveBeenCalled()
  })

  // B16: a refused message fell through with no answer, which API Gateway turned into a 502
  it('answers 100002 when the queue refuses the job', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(sendToQueue as jest.Mock).mockResolvedValue({ success: false })
    const res = await process(user)
    expect(res).toBeDefined()
    expect(JSON.parse(res!.body)).toEqual({ error_code: 100002, message: 'the payment could not be queued; nothing was charged' })
  })

  it('answers 100002 when queueing throws', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(sendToQueue as jest.Mock).mockRejectedValue(new Error('network'))
    const res = await process(user)
    expect(JSON.parse(res!.body).error_code).toBe(100002)
  })

  it('queues no field the handler does not list (B1)', async () => {
    await process(user, { queue: 'v1-sweep-queue', kmsKeyId: 'k' })
    const message = (sendToQueue as jest.Mock).mock.calls[0][1]
    expect(message.queue).toBe('v1-payment-processing-queue')
    expect(message).not.toHaveProperty('kmsKeyId')
  })
})
