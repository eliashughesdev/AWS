import ProcessGuestPaymentHandler, { isEncryptedCard } from './processGuest'
import { sendToQueue } from '../../../utils/sqs'

jest.mock('../../../utils/sqs', () => ({ sendToQueue: jest.fn() }))

// What src/pages/PaymentWidget.tsx sends: evervault.encrypt() of the card, as JSON
const card = { number: 'ev:Tk9OQ:num', cvc: 'ev:Tk9OQ:cvc', expiry: { month: 'ev:Tk9OQ:mm', year: 'ev:Tk9OQ:yy' } }
const processGuest = (cardData = JSON.stringify(card)) => new ProcessGuestPaymentHandler().execute({
  body: { cardData: { lastFour: '4242', bin: '42424242', cardType: 'visa', cardData }, userId: 'guest-1', amount: 50, currency: 'USD', transactionId: 'txn_1' },
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

  // Regression: a plain card was queued, and logged whole by the payment handler (PCI F6 step 4)
  it('answers 100031 without queueing a card that is not ciphertext', async () => {
    const res = await processGuest(JSON.stringify({ ...card, number: '4242424242424242' }))
    expect(JSON.parse(res!.body)).toEqual({ error_code: 100031, message: 'invalid value for cardData.cardData' })
    expect(sendToQueue).not.toHaveBeenCalled()
  })
})

describe('isEncryptedCard', () => {
  it.each([
    ['the widget\'s JSON', JSON.stringify(card)],
    ['one ev: value', 'ev:Tk9OQ:encrypted-card'],
  ])('accepts %s', (_, cardData) => {
    expect(isEncryptedCard(cardData)).toBe(true)
  })

  it.each([
    ['a plain number', { ...card, number: '4242424242424242' }],
    ['a plain cvc', { ...card, cvc: '123' }],
    ['a plain expiry', { ...card, expiry: { month: '12', year: 'ev:Tk9OQ:yy' } }],
    ['a missing cvc', { number: card.number, expiry: card.expiry }],
    ['an extra field', { ...card, name: 'John Doe' }],
    ['an extra expiry field', { ...card, expiry: { ...card.expiry, day: '01' } }],
    ['expiry as a string', { ...card, expiry: 'ev:Tk9OQ:exp' }],
    ['a number sent as a number', { ...card, number: 4242424242424242 }],
  ])('refuses JSON with %s', (_, value) => {
    expect(isEncryptedCard(JSON.stringify(value))).toBe(false)
  })

  it.each([
    ['broken JSON', '{"number":"ev:a"'],
    ['a JSON array', '["ev:a"]'],
    ['JSON null', 'null'],
  ])('refuses %s', (_, cardData) => {
    expect(isEncryptedCard(cardData)).toBe(false)
  })
})
