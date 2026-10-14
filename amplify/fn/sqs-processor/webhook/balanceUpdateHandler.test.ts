import { handleBalanceUpdate } from './balanceUpdateHandler'
import { putItem, updateItem } from '../../../utils/db'

const customerAddress = 'TCustomerDepositAddress'
const masterAddress = 'TMasterAddress'

// v2CustomerTable's deposit-address index: customer accounts only. Masters live in v1MerchantTable
const customers = [{ id: 'user-1', accountNo: 'PCF0001', vAccountId: 'va-1', chain: 'TRON', merchantId: 'acme', depositAddress: customerAddress }]
jest.mock('../../../utils/db', () => ({
  queryItemFromIndex: jest.fn(async ({ attributeValues }) =>
    ({ success: true, res: customers.filter(row => row.depositAddress === attributeValues[':addr']) })),
  putItem: jest.fn(async () => ({ success: true })),
  updateItem: jest.fn(async () => ({ success: true })),
}))
jest.mock('../../../utils/sqs', () => ({ sendToQueue: jest.fn() }))

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
