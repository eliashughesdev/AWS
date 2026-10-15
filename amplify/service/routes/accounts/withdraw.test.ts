import WithdrawHandler from './withdraw'
import { queryItemFromIndex, transactWriteItems, updateItem } from '../../../utils/db'
import { sendToQueue } from '../../../utils/sqs'
import { checkKyc } from '../../../utils/kycPolicy'

jest.mock('../../../utils/db', () => ({ queryItemFromIndex: jest.fn(), updateItem: jest.fn(), transactWriteItems: jest.fn() }))
jest.mock('../../../utils/sqs', () => ({ sendToQueue: jest.fn() }))
jest.mock('../../../utils/exchangeRate', () => ({ fetchCryptoPrice: jest.fn(async () => 0.25) }))
jest.mock('../../../utils/masterAccount', () => ({ getMasterAccount: jest.fn(async () => ({ key: 'master' })) }))
jest.mock('../../../utils/signing', () => ({ accountKeyRef: jest.fn(() => 'key-ref') }))
// The policy itself is tested in utils/kycPolicy.test.ts; here it allows unless a test says not
jest.mock('../../../utils/kycPolicy', () => ({ checkKyc: jest.fn() }))
beforeEach(() => jest.mocked(checkKyc).mockResolvedValue(undefined))

const tron = 'TPPjH6SeHdZQYYR3Yfk6Wr2xrazJc5MPPf'
const sol = 'EQ6iRuVbqobWug3MrAVfMHt72VT2mkwpCQ57jEfGqc9j'

const withdraw = (body: Record<string, unknown> = {}) => new WithdrawHandler().execute({
  requestContext: { authorizer: { userId: 'user-1', authType: 'jwt' } },
  body: { accountNumber: 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4', currency: 'TRON', cryptoAmount: 25, destinationAddress: tron, transactionId: 'wdr_1', ...body },
})

const answer = (res: { body: string } | undefined) => JSON.parse(res!.body)
// The debit goes with the withdrawal's record in one transaction; a rollback is a plain update
const transaction = () => jest.mocked(transactWriteItems).mock.calls[0]?.[0]
const debits = () => transaction()?.updates ?? []
const balanceUpdates = () => jest.mocked(updateItem).mock.calls.map(([call]) => call).filter(call => call.tableName === 'v1AccountBalanceTable')
const recordUpdates = () => jest.mocked(updateItem).mock.calls.map(([call]) => call).filter(call => call.tableName === 'v2CustomerTable')
const cancelled = (reasons: string[]) => ({ success: false, res: null, error: { name: 'TransactionCanceledException' }, reasons }) as any

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  ;(queryItemFromIndex as jest.Mock).mockResolvedValue({
    success: true,
    res: [{ id: 'user-1', vAccountId: 'va-1', chain: 'TRON', merchantId: 'internal-001' }],
  })
  ;(updateItem as jest.Mock).mockResolvedValue({ success: true })
  jest.mocked(transactWriteItems).mockResolvedValue({ success: true, res: {} as any, error: null })
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

  // docs/public-api-plan.md step 1.5: an API caller reads the outcome from this record
  it('writes the withdrawal\'s record as pending in the same transaction as the debit', async () => {
    ;(sendToQueue as jest.Mock).mockResolvedValue({ success: true, res: { MessageId: 'job-1' } })
    await withdraw()
    const [record] = transaction()!.puts
    expect(record.tableName).toBe('v2CustomerTable')
    expect(record.conditionExpression).toBe('attribute_not_exists(id)')
    expect(record.item).toMatchObject({
      id: 'user-1',
      sk: 'OP#wdr_1',
      opId: 'wdr_1',
      kind: 'withdrawal',
      status: 'pending',
      accountNumber: 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4',
      currency: 'TRON',
      amount: 25,
      destinationAddress: tron,
    })
  })

  it('answers 100031 for a transactionId used before, debiting and queueing nothing', async () => {
    jest.mocked(transactWriteItems).mockResolvedValue(cancelled(['ConditionalCheckFailed', 'None']))
    const res = await withdraw()
    expect(answer(res)).toEqual({ error_code: 100031, message: 'invalid value for transactionId' })
    expect(sendToQueue).not.toHaveBeenCalled()
  })

  // Regression: a SOL address sent to a TRON account was debited and failed later, in the queue processor
  it.each([
    ['another network\'s address', sol],
    ['an address cut short', tron.slice(0, 20)],
  ])('answers 100048 for %s, before debiting anything', async (_, destinationAddress) => {
    const res = await withdraw({ destinationAddress })
    expect(answer(res).error_code).toBe(100048)
    expect(transactWriteItems).not.toHaveBeenCalled()
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
    jest.mocked(transactWriteItems).mockResolvedValue(cancelled(['None', 'ThrottlingError']))
    const res = await withdraw()
    expect(answer(res)).toEqual({ error_code: 100002, message: 'the withdrawal could not be started; nothing was debited' })
    expect(sendToQueue).not.toHaveBeenCalled()
  })

  it('still answers 100007 when the available balance is too low', async () => {
    jest.mocked(transactWriteItems).mockResolvedValue(cancelled(['None', 'ConditionalCheckFailed']))
    expect(answer(await withdraw()).error_code).toBe(100007)
  })

  // Regression: the rollback credited back balance only, so availableBalance stayed short
  it('credits back both balances when the withdrawal cannot be queued', async () => {
    ;(sendToQueue as jest.Mock).mockResolvedValue({ success: false })
    const res = await withdraw()
    expect(answer(res)).toEqual({ error_code: 100002, message: 'the withdrawal could not be started; nothing was sent and the balance was restored' })
    const [debit] = debits()
    const [rollback] = balanceUpdates()
    expect(debit.attributeValues[':amount']).toBe(25)
    expect(rollback.attributeValues[':amount']).toBe(25)
    expect(rollback.updateExpression).toContain('#balance = #balance + :amount')
    expect(rollback.updateExpression).toContain('#availableBalance = #availableBalance + :amount')
    // The record says it failed: never sent
    const [settled] = recordUpdates()
    expect(settled.key).toEqual({ id: 'user-1', sk: 'OP#wdr_1' })
    expect(Object.values(settled.attributeValues)).toEqual(expect.arrayContaining(['failed', 100002]))
  })

  it('says so when the balance could not be credited back', async () => {
    ;(sendToQueue as jest.Mock).mockRejectedValue(new Error('network'))
    ;(updateItem as jest.Mock).mockImplementation(async ({ tableName }) =>
      tableName === 'v1AccountBalanceTable' ? { success: false, error: new Error('throttled') } : { success: true })
    const res = await withdraw()
    expect(answer(res)).toEqual({ error_code: 100002, message: 'the withdrawal could not be started; nothing was sent, but the balance could not be restored yet' })
  })
})

// docs/public-api-plan.md D11
describe('/accounts/withdraw KYC policy', () => {
  it('asks the account\'s merchant\'s policy for withdrawals in the account\'s currency', async () => {
    jest.mocked(queryItemFromIndex).mockResolvedValue({ success: true, res: [{ id: 'user-1', vAccountId: 'va-1', chain: 'TRON', merchantId: 'mrc_1' }] })
    jest.mocked(updateItem).mockResolvedValue({ success: true, res: {}, error: null } as any)
    jest.mocked(sendToQueue).mockResolvedValue({ success: true, res: { MessageId: 'job-1' } } as any)
    await withdraw()
    expect(checkKyc).toHaveBeenCalledWith({ userId: 'user-1', merchantId: 'mrc_1', currency: 'TRON', operation: 'withdraw' })
  })

  it('answers the refusal and debits and queues nothing', async () => {
    jest.mocked(queryItemFromIndex).mockResolvedValue({ success: true, res: [{ id: 'user-1', vAccountId: 'va-1', chain: 'TRON', merchantId: 'mrc_1' }] })
    jest.mocked(checkKyc).mockResolvedValue({ statusCode: 403, headers: {}, body: JSON.stringify({ error_code: 100059, message: 'x' }) } as any)
    const res = await withdraw()
    expect(res!.statusCode).toBe(403)
    expect(answer(res).error_code).toBe(100059)
    expect(transactWriteItems).not.toHaveBeenCalled()
    expect(sendToQueue).not.toHaveBeenCalled()
  })
})
