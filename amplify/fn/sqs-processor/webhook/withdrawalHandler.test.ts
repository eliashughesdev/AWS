import { handleWithdrawal } from './withdrawalHandler'
import { putItem, updateItem } from '../../../utils/db'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { getMasterAccount } from '../../../utils/masterAccount'
import { findAccountForUser } from '../../../utils/custodialAccount'
import { notifyPaymentResult } from '../../../utils/websocket'

jest.mock('../../../utils/db', () => ({
  putItem: jest.fn(async () => ({ success: true })),
  updateItem: jest.fn(async () => ({ success: true })),
}))
jest.mock('../../../utils/AccountProvider', () => ({ ProviderRegistry: { getProvider: jest.fn() } }))
jest.mock('../../../utils/masterAccount', () => ({ getMasterAccount: jest.fn() }))
jest.mock('../../../utils/custodialAccount', () => ({ findAccountForUser: jest.fn() }))
jest.mock('../../../utils/websocket', () => ({ notifyPaymentResult: jest.fn() }))

const destination = 'TPPjH6SeHdZQYYR3Yfk6Wr2xrazJc5MPPf'
const customerAddress = 'TCustomerDepositAddress'
const masterAddress = 'TMasterAddress'

const account = (chain: string) =>
  ({ id: 'user-1', sk: 'ACCOUNT#PCF0001', accountNo: 'PCF0001', keyModel: 'hd', vAccountId: 'va-1', chain, merchantId: 'acme', depositAddress: customerAddress })
const master = (currency: string) =>
  ({ depositAddress: masterAddress, key: { merchantId: 'acme', currency }, vAccountId: 'va-master' })

const provider = {
  withdrawFunds: jest.fn(),
  getTransactionFee: jest.fn<Promise<number | null>, any[]>(),
  debitFee: jest.fn(),
}

const message = { transactionId: 'wdr_1', userId: 'user-1', vAccountId: 'va-1', cryptoAmount: 25, destinationAddress: destination }

const holding = (chain: string, withMaster: boolean) => {
  ;(findAccountForUser as jest.Mock).mockResolvedValue(account(chain))
  ;(getMasterAccount as jest.Mock).mockResolvedValue(withMaster ? master(chain) : null)
}

const unsettled = () => (console.error as jest.Mock).mock.calls.filter(([text]) => String(text).startsWith('CRITICAL FEE_UNSETTLED'))
const rolledBack = () => (updateItem as jest.Mock).mock.calls.some(([call]) => call.attributeValues[':amount'] === 25)

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  ;(ProviderRegistry.getProvider as jest.Mock).mockReturnValue(provider)
  provider.withdrawFunds.mockReset().mockResolvedValue({ withdrawalId: 'wd-1', masterWithdrawalId: 'wd-2', txId: 'tx-1' })
  provider.getTransactionFee.mockReset().mockResolvedValue(0.268)
  provider.debitFee.mockReset().mockResolvedValue('wd-fee')
})
afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe('handleWithdrawal: who signs', () => {
  // native-sweep-plan step 2: native coins are swept to the master (step 3), so the master sends them
  it.each(['TRON', 'SOL'])('signs a %s withdrawal as the master when the merchant has one, and debits both VAs', async chain => {
    holding(chain, true)
    expect(await handleWithdrawal(message)).toBe(true)
    expect(provider.withdrawFunds).toHaveBeenCalledWith({
      accountId: 'va-1',
      address: destination,
      amount: '25',
      currency: chain,
      key: { merchantId: 'acme', currency: chain },
      senderAddress: masterAddress,
      masterAccountId: 'va-master',
    })
  })

  it('sends a native withdrawal from the customer\'s own address while the merchant has no master', async () => {
    holding('TRON', false)
    expect(await handleWithdrawal(message)).toBe(true)
    expect(provider.withdrawFunds).toHaveBeenCalledWith(expect.objectContaining({
      key: { accountNo: 'PCF0001' }, senderAddress: customerAddress, masterAccountId: undefined,
    }))
    // Tatum holds back its fixed fee and the fee webhook charges the customer
    expect(provider.getTransactionFee).not.toHaveBeenCalled()
  })

  it('signs a token withdrawal as the master and settles no fee: its gas is rented TRX', async () => {
    holding('USDT_TRON', true)
    expect(await handleWithdrawal(message)).toBe(true)
    expect(provider.withdrawFunds).toHaveBeenCalledWith(expect.objectContaining({ senderAddress: masterAddress, masterAccountId: 'va-master' }))
    expect(provider.getTransactionFee).not.toHaveBeenCalled()
  })

  it('refuses a token withdrawal with no master and credits the balance back', async () => {
    holding('USDT_TRON', false)
    expect(await handleWithdrawal(message)).toBe(false)
    expect(provider.withdrawFunds).not.toHaveBeenCalled()
    expect(rolledBack()).toBe(true)
  })
})

describe('handleWithdrawal: the fee a master paid', () => {
  it.each([
    ['TRON', 0.268],
    ['SOL', 0.000005],
  ])('charges the %s customer the receipt\'s fee, in DynamoDB and off both VAs', async (chain, fee) => {
    holding(chain, true)
    provider.getTransactionFee.mockResolvedValueOnce(fee)
    expect(await handleWithdrawal(message)).toBe(true)

    expect(provider.getTransactionFee).toHaveBeenCalledWith({ chain, txId: 'tx-1' })
    // The row the fee webhook writes, which NODA's Fee column reads by txId
    expect(putItem).toHaveBeenCalledWith('v1TransactionLogsTable', expect.objectContaining({
      id: 'va-1', sk: 'TX#tx-1', txId: 'tx-1', type: 'FEE', amount: fee, currency: chain, from: masterAddress,
    }), 'attribute_not_exists(sk)')
    expect(updateItem).toHaveBeenCalledWith(expect.objectContaining({ key: { id: 'va-1' }, attributeValues: expect.objectContaining({ ':delta': -fee }) }))
    expect(provider.debitFee).toHaveBeenCalledTimes(2)
    expect(provider.debitFee).toHaveBeenCalledWith({ accountId: 'va-1', address: destination, amount: fee, currency: chain, txId: 'tx-1' })
    expect(provider.debitFee).toHaveBeenCalledWith({ accountId: 'va-master', address: destination, amount: fee, currency: chain, txId: 'tx-1' })
    expect(unsettled()).toHaveLength(0)
  })

  it('writes a FEE row of 0 and asks nothing of Tatum when the master\'s free bandwidth paid', async () => {
    holding('TRON', true)
    provider.getTransactionFee.mockResolvedValueOnce(0)
    expect(await handleWithdrawal(message)).toBe(true)
    expect(putItem).toHaveBeenCalledWith('v1TransactionLogsTable', expect.objectContaining({ sk: 'TX#tx-1', type: 'FEE', amount: 0 }), 'attribute_not_exists(sk)')
    expect(provider.debitFee).not.toHaveBeenCalled()
  })

  it('tells the user the withdrawal went out before waiting for the receipt', async () => {
    holding('TRON', true)
    await handleWithdrawal(message)
    expect((notifyPaymentResult as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(provider.getTransactionFee.mock.invocationCallOrder[0])
  })

  it('asks again while the transaction is not in a block, or the receipt cannot be read', async () => {
    jest.useFakeTimers()
    holding('TRON', true)
    provider.getTransactionFee
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('node timeout'))
      .mockResolvedValueOnce(0.268)
    const done = handleWithdrawal(message)
    await jest.runAllTimersAsync()
    expect(await done).toBe(true)
    expect(provider.getTransactionFee).toHaveBeenCalledTimes(3)
    expect(provider.debitFee).toHaveBeenCalledTimes(2)
  })

  it('logs a receipt that never comes, to be settled by hand, and rolls nothing back', async () => {
    jest.useFakeTimers()
    holding('TRON', true)
    provider.getTransactionFee.mockResolvedValue(null)
    const done = handleWithdrawal(message)
    await jest.runAllTimersAsync()
    expect(await done).toBe(true)

    // Every 3 s for 90 s
    expect(provider.getTransactionFee).toHaveBeenCalledTimes(31)
    expect(unsettled()).toHaveLength(1)
    expect(unsettled()[0][0]).toMatch(/txId=tx-1, vAccountId=va-1, master=va-master/)
    expect(putItem).not.toHaveBeenCalledWith('v1TransactionLogsTable', expect.objectContaining({ type: 'FEE' }), expect.anything())
    expect(provider.debitFee).not.toHaveBeenCalled()
    expect(rolledBack()).toBe(false)
  })

  it('still debits the master\'s VA when the customer\'s refuses, and rolls nothing back', async () => {
    holding('TRON', true)
    provider.debitFee.mockRejectedValueOnce(new Error('insufficient balance'))
    expect(await handleWithdrawal(message)).toBe(true)
    expect(provider.debitFee).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: 'va-master' }))
    expect(unsettled()).toHaveLength(1)
    expect(unsettled()[0][0]).toMatch(/VA va-1 was not debited/)
    expect(rolledBack()).toBe(false)
  })

  it('logs a FEE row that cannot be written and still debits both VAs', async () => {
    holding('TRON', true)
    ;(updateItem as jest.Mock).mockResolvedValueOnce({ success: false, error: new Error('throttled') })
    expect(await handleWithdrawal(message)).toBe(true)
    expect(unsettled()[0][0]).toMatch(/FEE row or the balance was not written/)
    expect(provider.debitFee).toHaveBeenCalledTimes(2)
  })
})
