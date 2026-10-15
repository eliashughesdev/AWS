import { handleSweep } from './sweepHandler'
import { putItem } from '../../../utils/db'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { getMasterAccount } from '../../../utils/masterAccount'
import { findAccountByAddress } from '../../../utils/custodialAccount'

jest.mock('../../../utils/db', () => ({ putItem: jest.fn(async () => ({ success: true })) }))
jest.mock('../../../utils/AccountProvider', () => ({ ProviderRegistry: { getProvider: jest.fn() } }))
jest.mock('../../../utils/masterAccount', () => ({ getMasterAccount: jest.fn() }))
jest.mock('../../../utils/custodialAccount', () => ({ findAccountByAddress: jest.fn() }))

const customerAddress = 'TCustomerDepositAddress'
const masterAddress = 'TMasterAddress'

// v2CustomerTable's deposit-address index holds customer accounts only. Masters live in v1MerchantTable
const holding = (chain: string) => {
  const account = { id: 'user-1', accountNo: 'PCF0001', keyModel: 'hd', vAccountId: 'va-1', chain, merchantId: 'acme', depositAddress: customerAddress }
  ;(findAccountByAddress as jest.Mock).mockImplementation(async address => address === customerAddress ? account : null)
  ;(getMasterAccount as jest.Mock).mockResolvedValue({ depositAddress: masterAddress, key: { merchantId: 'acme', currency: chain }, vAccountId: 'va-master' })
}

const provider = {
  canReceiveSweep: jest.fn(),
  sweepAll: jest.fn(),
  sendOnChain: jest.fn(),
  debitFee: jest.fn(),
}

// What balanceUpdateHandler queues, plus fields an attacker would want honoured
const deposit = (senderAddress = customerAddress) =>
  ({ vAccountId: 'va-1', senderAddress, amount: 25, currency: 'SOL', txId: 'deposit-1', merchantId: 'someone-else', kmsKeyId: 'someone-elses-key' })

const logged = (spy: 'log' | 'error', prefix: string) => (console[spy] as jest.Mock).mock.calls.filter(([text]) => String(text).startsWith(prefix))

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  ;(ProviderRegistry.getProvider as jest.Mock).mockReturnValue(provider)
  ;(putItem as jest.Mock).mockClear().mockResolvedValue({ success: true })
  provider.canReceiveSweep.mockReset().mockResolvedValue(true)
  provider.sweepAll.mockReset().mockResolvedValue({ txId: 'sweep-1', amount: 25, fee: 0 })
  provider.sendOnChain.mockReset().mockResolvedValue({ txId: 'sweep-1' })
  provider.debitFee.mockReset().mockResolvedValue('wd-fee')
})
afterEach(() => jest.restoreAllMocks())

// native-sweep-plan step 3
describe('handleSweep: native coins', () => {
  it('sweeps a TRX address whole to its merchant\'s master, signed by its own key, when free bandwidth pays', async () => {
    holding('TRON')
    expect(await handleSweep(deposit())).toBe(true)
    expect(getMasterAccount).toHaveBeenCalledWith('acme', 'TRON')
    expect(provider.canReceiveSweep).toHaveBeenCalledWith({ chain: 'TRON', address: masterAddress })
    expect(provider.sweepAll).toHaveBeenCalledWith({ chain: 'TRON', senderAddress: customerAddress, recipientAddress: masterAddress, key: { accountNo: 'PCF0001' } })
    expect(provider.sendOnChain).not.toHaveBeenCalled()
    // The fee webhook writes the FEE 0 row; Tatum has nothing to take
    expect(provider.debitFee).not.toHaveBeenCalled()
  })

  it.each([
    ['TRON', 0.268],
    ['SOL', 0.000005],
  ])('takes a %s sweep\'s fee off the customer\'s VA, completed with the sweep\'s txId', async (chain, fee) => {
    holding(chain)
    provider.sweepAll.mockResolvedValueOnce({ txId: 'sweep-1', amount: 24.7, fee })
    expect(await handleSweep(deposit())).toBe(true)
    expect(provider.debitFee).toHaveBeenCalledTimes(1)
    expect(provider.debitFee).toHaveBeenCalledWith({ accountId: 'va-1', address: masterAddress, amount: fee, currency: chain, txId: 'sweep-1' })
  })

  it('claims the deposit before it moves anything', async () => {
    holding('TRON')
    await handleSweep(deposit())
    expect(putItem).toHaveBeenCalledWith('v1TransactionLogsTable', expect.objectContaining({ id: 'va-1', sk: 'SWEEP#deposit-1', currency: 'TRON', to: masterAddress }), 'attribute_not_exists(sk)')
    expect((putItem as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(provider.sweepAll.mock.invocationCallOrder[0])
  })

  it('leaves dust that cannot pay the fee, and charges nothing', async () => {
    holding('TRON')
    provider.sweepAll.mockResolvedValueOnce(null)
    expect(await handleSweep(deposit())).toBe(true)
    expect(provider.debitFee).not.toHaveBeenCalled()
    expect(logged('log', 'SWEEP_SKIPPED')).toHaveLength(1)
  })

  it.each(['TRON', 'SOL'])('does not claim or sweep while the %s master is not activated or funded', async chain => {
    holding(chain)
    provider.canReceiveSweep.mockResolvedValueOnce(false)
    expect(await handleSweep(deposit())).toBe(false)
    expect(putItem).not.toHaveBeenCalled()
    expect(provider.sweepAll).not.toHaveBeenCalled()
    expect(logged('error', 'CONFIG_ERROR')).toHaveLength(1)
  })

  it('does not claim or sweep when the master cannot be read', async () => {
    holding('TRON')
    provider.canReceiveSweep.mockRejectedValueOnce(new Error('node timeout'))
    expect(await handleSweep(deposit())).toBe(false)
    expect(putItem).not.toHaveBeenCalled()
    expect(provider.sweepAll).not.toHaveBeenCalled()
  })

  it('never sweeps a master: no customer account has its address', async () => {
    holding('TRON')
    expect(await handleSweep(deposit(masterAddress))).toBe(false)
    expect(provider.canReceiveSweep).not.toHaveBeenCalled()
    expect(provider.sweepAll).not.toHaveBeenCalled()
  })

  it('charges no fee when the sweep fails', async () => {
    holding('SOL')
    provider.sweepAll.mockRejectedValueOnce(new Error('preflight failed'))
    expect(await handleSweep(deposit())).toBe(false)
    expect(provider.debitFee).not.toHaveBeenCalled()
    expect(logged('error', 'SWEEP_ERROR')).toHaveLength(1)
  })

  it('logs a fee Tatum refused to be settled by hand, but the sweep went out', async () => {
    holding('TRON')
    provider.sweepAll.mockResolvedValueOnce({ txId: 'sweep-1', amount: 24.732, fee: 0.268 })
    provider.debitFee.mockRejectedValueOnce(new Error('Tatum 500'))
    expect(await handleSweep(deposit())).toBe(true)
    expect(logged('error', 'CRITICAL FEE_UNSETTLED')).toHaveLength(1)
    expect(logged('error', 'SWEEP_ERROR')).toHaveLength(0)
  })
})

describe('handleSweep: tokens', () => {
  it('sends the deposited amount with sendOnChain, without checking the master or settling a fee', async () => {
    holding('USDT_TRON')
    expect(await handleSweep(deposit())).toBe(true)
    expect(provider.sendOnChain).toHaveBeenCalledWith({ chain: 'USDT_TRON', senderAddress: customerAddress, recipientAddress: masterAddress, amount: '25', key: { accountNo: 'PCF0001' } })
    expect(provider.canReceiveSweep).not.toHaveBeenCalled()
    expect(provider.sweepAll).not.toHaveBeenCalled()
    expect(provider.debitFee).not.toHaveBeenCalled()
  })
})
