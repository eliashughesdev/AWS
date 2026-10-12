import { handlePayment } from './paymentHandler'
import { PaymentOrchestrator } from '../../../utils/PaymentOrchestrator'
import { notifyPaymentResult } from '../../../utils/websocket'

// v2CustomerTable as DynamoDB keys it: a card row is found by its owner's id and its own sk only
const table = [
  { id: 'user-a', sk: 'PAYMENT#card-a', cardData: { cardData: 'ev:card-of-a' } },
  { id: 'user-b', sk: 'PAYMENT#card-b', cardData: { cardData: 'ev:card-of-b' } },
]
jest.mock('../../../utils/db', () => ({
  queryRecord: jest.fn(async (_table: string, _condition: string, values: Record<string, string>) =>
    ({ success: true, res: table.filter(row => row.id === values[':id'] && row.sk === values[':sk']) })),
  updateItem: jest.fn(),
}))
jest.mock('../../../utils/config', () => ({ loadConfig: jest.fn() }))
jest.mock('../../../utils/websocket', () => ({ notifyPaymentResult: jest.fn() }))
jest.mock('../../../utils/paymentLogger', () => ({
  generatePaymentOrderId: () => 'order-1',
  createOrderLog: jest.fn(),
  logAttempt: jest.fn(),
  updateOrderStatus: jest.fn(),
}))
jest.mock('../../../utils/PaymentOrchestrator', () => ({ PaymentOrchestrator: { processWithFailover: jest.fn() } }))
jest.mock('./balanceUpdateHandler', () => ({ creditAccountByVAccountId: jest.fn() }))

const message = (userId: string, paymentId: string) =>
  ({ queue: 'v1-payment-processing-queue', userId, paymentId, transactionId: 'txn_1', amount: 50, currency: 'USD' })

beforeEach(() => {
  process.env.EVERVAULT_APP_ID = 'app_test'
  for (const level of ['log', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {})
  ;(PaymentOrchestrator.processWithFailover as jest.Mock).mockResolvedValue({ success: false, status: 'failed', error: 'declined in test' })
})
afterEach(() => jest.clearAllMocks())

// pci-remediation-plan.md F3 step 5: the queue charges a saved card only for the user who owns it.
// The card is looked up by the message's userId and the card id together, so another user's card
// id finds nothing; the route puts the caller's own userId in the message (utils/payer.ts)
describe('handlePayment: whose card is charged', () => {
  it('charges a user\'s own card', async () => {
    await handlePayment(message('user-b', 'card-b'))
    expect(PaymentOrchestrator.processWithFailover).toHaveBeenCalledWith(
      'stripe', expect.objectContaining({ userId: 'user-b', cardData: { cardData: 'ev:card-of-b' } }), expect.anything(), expect.anything())
  })

  it('charges nothing when the card belongs to another user', async () => {
    expect(await handlePayment(message('user-a', 'card-b'))).toBe(false)
    expect(PaymentOrchestrator.processWithFailover).not.toHaveBeenCalled()
    expect(notifyPaymentResult).toHaveBeenCalledWith('txn_1', 'user-a', expect.objectContaining({ error: 'Payment method not found' }), 'card-b')
  })
})
