import WithdrawHandler from './withdraw'
import { queryItemFromIndex, updateItem } from '../../../utils/db'
import { sendToQueue } from '../../../utils/sqs'

jest.mock('../../../utils/db', () => ({ queryItemFromIndex: jest.fn(), updateItem: jest.fn() }))
jest.mock('../../../utils/sqs', () => ({ sendToQueue: jest.fn() }))
jest.mock('../../../utils/exchangeRate', () => ({ fetchCryptoPrice: jest.fn(async () => 0.25) }))
jest.mock('../../../utils/masterAccount', () => ({ getMasterAccount: jest.fn(async () => ({ key: 'master' })) }))
jest.mock('../../../utils/signing', () => ({ accountKeyRef: jest.fn(() => 'key-ref') }))

const tron = 'TPPjH6SeHdZQYYR3Yfk6Wr2xrazJc5MPPf'
const sol = 'EQ6iRuVbqobWug3MrAVfMHt72VT2mkwpCQ57jEfGqc9j'

const withdraw = (body: Record<string, unknown> = {}) => new WithdrawHandler().execute({
  requestContext: { authorizer: { userId: 'user-1', authType: 'jwt' } },
  body: { accountNumber: 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4', currency: 'TRON', cryptoAmount: 25, destinationAddress: tron, transactionId: 'wdr_1', ...body },
})

const answer = (res: { body: string } | undefined) => JSON.parse(res!.body)
const debits = () => (updateItem as jest.Mock).mock.calls.map(([call]) => call)

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  ;(queryItemFromIndex as jest.Mock).mockResolvedValue({
    success: true,
    res: [{ id: 'user-1', vAccountId: 'va-1', chain: 'TRON', merchantId: 'internal-001' }],
  })
  ;(updateItem as jest.Mock).mockResolvedValue({ success: true })
})
afterEach(() => jest.restoreAllMocks())

describe('/accounts/withdraw handler', () => {
  it('debits both balances and queues the withdrawal', async () => {
    ;(sendToQueue as jest.Mock).mockResolvedValue({ success: true, res: { MessageId: 'job-1' } })
    const res = await withdraw()
    expect(res!.statusCode).toBe(200)
    expect(debits()).toHaveLength(1)
    expect(debits()[0].updateExpression).toContain('#availableBalance = #availableBalance - :amount')
  })

  // Regression: a SOL address sent to a TRON account was debited and failed later, in the queue processor
  it.each([
    ['another network\'s address', sol],
    ['an address cut short', tron.slice(0, 20)],
  ])('answers 100048 for %s, before debiting anything', async (_, destinationAddress) => {
    const res = await withdraw({ destinationAddress })
    expect(answer(res).error_code).toBe(100048)
    expect(updateItem).not.toHaveBeenCalled()
    expect(sendToQueue).not.toHaveBeenCalled()
  })

  it('takes a token\'s address on its network', async () => {
    ;(queryItemFromIndex as jest.Mock).mockResolvedValue({
      success: true,
      res: [{ id: 'user-1', vAccountId: 'va-1', chain: 'USDT_TRON', merchantId: 'internal-001' }],
    })
    ;(sendToQueue as jest.Mock).mockResolvedValue({ success: true, res: { MessageId: 'job-1' } })
    expect((await withdraw({ currency: 'USDT_TRON' }))!.statusCode).toBe(200)
  })

  // Regression: this answered 100029, the code for a missing parameter
  it('answers 100002 when the debit fails for another reason than the balance', async () => {
    ;(updateItem as jest.Mock).mockResolvedValue({ success: false, error: { name: 'ProvisionedThroughputExceededException' } })
    const res = await withdraw()
    expect(answer(res)).toEqual({ error_code: 100002, message: 'the withdrawal could not be started; nothing was debited' })
    expect(sendToQueue).not.toHaveBeenCalled()
  })

  it('still answers 100007 when the available balance is too low', async () => {
    ;(updateItem as jest.Mock).mockResolvedValue({ success: false, error: { name: 'ConditionalCheckFailedException' } })
    expect(answer(await withdraw()).error_code).toBe(100007)
  })

  // Regression: the rollback credited back balance only, so availableBalance stayed short
  it('credits back both balances when the withdrawal cannot be queued', async () => {
    ;(sendToQueue as jest.Mock).mockResolvedValue({ success: false })
    const res = await withdraw()
    expect(answer(res)).toEqual({ error_code: 100002, message: 'the withdrawal could not be started; nothing was sent and the balance was restored' })
    const [debit, rollback] = debits()
    expect(debit.attributeValues[':amount']).toBe(25)
    expect(rollback.attributeValues[':amount']).toBe(25)
    expect(rollback.updateExpression).toContain('#balance = #balance + :amount')
    expect(rollback.updateExpression).toContain('#availableBalance = #availableBalance + :amount')
  })

  it('says so when the balance could not be credited back', async () => {
    ;(sendToQueue as jest.Mock).mockRejectedValue(new Error('network'))
    ;(updateItem as jest.Mock)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: new Error('throttled') })
    const res = await withdraw()
    expect(answer(res)).toEqual({ error_code: 100002, message: 'the withdrawal could not be started; nothing was sent, but the balance could not be restored yet' })
  })
})
