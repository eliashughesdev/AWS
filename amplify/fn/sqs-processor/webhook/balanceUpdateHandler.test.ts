import { handleBalanceUpdate } from './balanceUpdateHandler'
import { putItem, updateItem } from '../../../utils/db'
import { sendToQueue } from '../../../utils/sqs'
import { getMasterAccount } from '../../../utils/masterAccount'

const customerAddress = 'TCustomerDepositAddress'
const solAddress = 'SolCustomerDepositAddress'
const usdtAddress = 'TUsdtCustomerDepositAddress'
const masterAddress = 'TMasterAddress'

// v2CustomerTable's deposit-address index: customer accounts only. Masters live in v1MerchantTable
const customers = [
  { id: 'user-1', accountNo: 'PCF0001', keyModel: 'hd', vAccountId: 'va-1', chain: 'TRON', merchantId: 'acme', depositAddress: customerAddress },
  { id: 'user-1', accountNo: 'PCF0002', keyModel: 'hd', vAccountId: 'va-2', chain: 'SOL', merchantId: 'acme', depositAddress: solAddress },
  { id: 'user-1', accountNo: 'PCF0003', keyModel: 'hd', vAccountId: 'va-3', chain: 'USDT_TRON', merchantId: 'acme', depositAddress: usdtAddress },
]
jest.mock('../../../utils/db', () => ({
  queryItemFromIndex: jest.fn(async ({ attributeValues }) =>
    ({ success: true, res: customers.filter(row => row.depositAddress === attributeValues[':addr']) })),
  putItem: jest.fn(async () => ({ success: true })),
  updateItem: jest.fn(async () => ({ success: true })),
}))
jest.mock('../../../utils/sqs', () => ({ sendToQueue: jest.fn(async () => ({ success: true })) }))
jest.mock('../../../utils/masterAccount', () => ({ getMasterAccount: jest.fn() }))

// The payer is in counterAddress on TRON and in address on Solana
const tronFee = (payer: string) => ({ type: 'fee', asset: 'TRON', counterAddress: payer, amount: '-0.268', txId: 'tx-1', subscriptionType: 'ADDRESS_TRANSACTION' })
const solFee = (payer: string) => ({ type: 'fee', asset: 'SOL', address: payer, amount: '-0.000005', txId: 'sig-1', subscriptionType: 'ADDRESS_TRANSACTION' })

describe('handleBalanceUpdate: fee events', () => {
  // native-sweep-plan step 2: the withdrawal handler charges a master-signed withdrawal's fee from
  // its receipt, so a fee event that names the master (e.g. through the recipient's subscription)
  // must not charge anyone a second time
  it.each([
    ['TRON', tronFee(masterAddress)],
    ['SOL', solFee(masterAddress)],
  ])('skips a %s fee a master paid: no account has its address', async (_, event) => {
    expect(await handleBalanceUpdate(event)).toBe(true)
    expect(putItem).not.toHaveBeenCalled()
    expect(updateItem).not.toHaveBeenCalled()
  })

  it('debits a fee its own customer paid', async () => {
    expect(await handleBalanceUpdate(tronFee(customerAddress))).toBe(true)
    expect(putItem).toHaveBeenCalledWith('v1TransactionLogsTable', expect.objectContaining({
      id: 'va-1', sk: 'TX#tx-1', type: 'FEE', amount: 0.268, currency: 'TRON', from: customerAddress,
    }), 'attribute_not_exists(sk)')
    expect(updateItem).toHaveBeenCalledWith(expect.objectContaining({ key: { id: 'va-1' }, attributeValues: expect.objectContaining({ ':delta': -0.268 }) }))
  })
})

// Tatum's TRON event: address is the recipient, counterAddress the sender, amount positive
const tronDeposit = (to: string, from = 'TSomeoneOutside', asset = 'TRON') =>
  ({ type: 'native', asset, address: to, counterAddress: from, amount: '25', txId: 'deposit-1', subscriptionType: 'ADDRESS_TRANSACTION' })
const solDeposit = { type: 'native', asset: 'SOL', address: solAddress, counterAddresses: ['SolSomeoneOutside'], amount: '25', txId: 'deposit-1', subscriptionType: 'ADDRESS_TRANSACTION' }
const master = { depositAddress: masterAddress, key: { merchantId: 'acme', currency: 'TRON' }, vAccountId: 'va-master' }

describe('handleBalanceUpdate: sweeps', () => {
  // native-sweep-plan step 3: a ready native master is what switches a merchant to native sweeps
  it.each([
    ['TRON', tronDeposit(customerAddress), 'va-1', customerAddress],
    ['SOL', solDeposit, 'va-2', solAddress],
  ])('queues a %s deposit for a sweep once the merchant has a master for the coin', async (chain, event, vAccountId, address) => {
    ;(getMasterAccount as jest.Mock).mockResolvedValue(master)
    expect(await handleBalanceUpdate(event)).toBe(true)
    expect(getMasterAccount).toHaveBeenCalledWith('acme', chain)
    expect(sendToQueue).toHaveBeenCalledWith(expect.any(String), {
      queue: 'v1-sweep-queue', vAccountId, senderAddress: address, amount: 25, currency: chain, txId: 'deposit-1',
    })
  })

  it('leaves a native deposit on the customer\'s address while the merchant has no master for it', async () => {
    ;(getMasterAccount as jest.Mock).mockResolvedValue(null)
    expect(await handleBalanceUpdate(tronDeposit(customerAddress))).toBe(true)
    expect(updateItem).toHaveBeenCalledWith(expect.objectContaining({ key: { id: 'va-1' }, attributeValues: expect.objectContaining({ ':delta': 25 }) }))
    expect(sendToQueue).not.toHaveBeenCalled()
  })

  it('queues a token deposit without asking for its master: the sweep handler refuses one it lacks', async () => {
    expect(await handleBalanceUpdate(tronDeposit(usdtAddress, 'TSomeoneOutside', 'USDT_TRON'))).toBe(true)
    expect(getMasterAccount).not.toHaveBeenCalled()
    expect(sendToQueue).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ vAccountId: 'va-3', currency: 'USDT_TRON' }))
  })

  it('credits and queues nothing for the sweep itself, which names the master as its recipient', async () => {
    ;(getMasterAccount as jest.Mock).mockResolvedValue(master)
    expect(await handleBalanceUpdate(tronDeposit(masterAddress, customerAddress))).toBe(true)
    expect(putItem).not.toHaveBeenCalled()
    expect(updateItem).not.toHaveBeenCalled()
    expect(sendToQueue).not.toHaveBeenCalled()
  })
})
