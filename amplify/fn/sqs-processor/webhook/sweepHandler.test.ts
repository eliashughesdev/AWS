import { handleSweep } from './sweepHandler'
import { putItem, queryRecord } from '../../../utils/db'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { getFeeAccountId, getMasterAccount } from '../../../utils/masterAccount'
import { findAccountByAddress } from '../../../utils/custodialAccount'
import { isTronAccountActive } from '../../../providers/ledger/tatum/chains/tron'
import { fetchCryptoPrice } from '../../../utils/exchangeRate'
import { applyBalanceChangeOnce } from '../../../utils/balance'
import type { Activation } from '../../../providers/energy/EnergyProvider'

jest.mock('../../../utils/db', () => ({ putItem: jest.fn(async () => ({ success: true })), queryRecord: jest.fn() }))
jest.mock('../../../utils/AccountProvider', () => ({ ProviderRegistry: { getProvider: jest.fn() } }))
jest.mock('../../../utils/masterAccount', () => ({ getMasterAccount: jest.fn(), getFeeAccountId: jest.fn() }))
jest.mock('../../../utils/custodialAccount', () => ({ findAccountByAddress: jest.fn() }))
jest.mock('../../../providers/ledger/tatum/chains/tron', () => ({ isTronAccountActive: jest.fn() }))
// The dearest of the providers configured: TronSave's 1.5 TRX
jest.mock('../../../providers/energy/ensureResources', () => ({ maxActivationSun: () => 1_500_000 }))
jest.mock('../../../utils/exchangeRate', () => ({ fetchCryptoPrice: jest.fn() }))
jest.mock('../../../utils/balance', () => ({ applyBalanceChangeOnce: jest.fn() }))

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
  getOnChainBalance: jest.fn(),
  transferFunds: jest.fn(),
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
  provider.getOnChainBalance.mockReset().mockResolvedValue(25)
  provider.transferFunds.mockReset().mockResolvedValue({ reference: 'ledger-tx-1' })
  ;(isTronAccountActive as jest.Mock).mockReset().mockResolvedValue(true)
  ;(fetchCryptoPrice as jest.Mock).mockReset().mockResolvedValue(0.33)
  ;(queryRecord as jest.Mock).mockReset().mockResolvedValue({ success: true, res: [{ id: 'va-1', availableBalance: 25 }] })
  ;(applyBalanceChangeOnce as jest.Mock).mockReset().mockResolvedValue('applied')
  ;(getFeeAccountId as jest.Mock).mockReset().mockResolvedValue('va-fee')
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
  // energy-rental-plan step 3: a sweep that waited, or failed, left coins the deposit's amount would not move
  it('sends the address\'s whole token balance, read on chain, and charges nothing when it is active', async () => {
    holding('USDT_TRON')
    provider.getOnChainBalance.mockResolvedValueOnce(37.5)
    expect(await handleSweep(deposit())).toBe(true)
    expect(provider.getOnChainBalance).toHaveBeenCalledWith({ chain: 'USDT_TRON', address: customerAddress })
    expect(provider.sendOnChain).toHaveBeenCalledWith({ chain: 'USDT_TRON', senderAddress: customerAddress, recipientAddress: masterAddress, amount: '37.5', key: { accountNo: 'PCF0001' }, onActivated: undefined })
    expect(isTronAccountActive).toHaveBeenCalledWith(customerAddress)
    expect(fetchCryptoPrice).not.toHaveBeenCalled()
    expect(provider.canReceiveSweep).not.toHaveBeenCalled()
    expect(provider.sweepAll).not.toHaveBeenCalled()
    expect(provider.debitFee).not.toHaveBeenCalled()
  })

  it('sends nothing when the address holds none of the token', async () => {
    holding('USDT_TRON')
    provider.getOnChainBalance.mockResolvedValueOnce(0)
    expect(await handleSweep(deposit())).toBe(true)
    expect(provider.sendOnChain).not.toHaveBeenCalled()
    expect(logged('log', 'SWEEP_SKIPPED')).toHaveLength(1)
  })
})

// energy-rental-plan step 3 (D6, D7)
describe('handleSweep: a token address never activated', () => {
  // What a provider does with the hook once it has paid for the activation
  const activatingWith = (activation: Activation, then = async () => ({ txId: 'sweep-1' })) =>
    async ({ onActivated }: { onActivated?: (a: Activation) => Promise<void> }) => {
      await onActivated?.(activation)
      return then()
    }

  beforeEach(() => {
    holding('USDT_TRON')
    ;(isTronAccountActive as jest.Mock).mockResolvedValue(false)
  })

  // 1.5 TRX at 0.3002 is 0.4503 USDT; in floats 1,500,000 × 0.3002 is 450,300.00000000006, which would round up to 0.450301
  it.each([
    [0.450299, false],
    [0.4503, true],
  ])('with %s USDT available, sweeps only when the balance covers the dearest activation: %s', async (availableBalance, swept) => {
    ;(fetchCryptoPrice as jest.Mock).mockResolvedValueOnce(0.3002)
    ;(queryRecord as jest.Mock).mockResolvedValueOnce({ success: true, res: [{ id: 'va-1', availableBalance }] })
    expect(await handleSweep(deposit())).toBe(true)
    expect(fetchCryptoPrice).toHaveBeenCalledWith('TRON', 'USDT')
    expect(queryRecord).toHaveBeenCalledWith('v1AccountBalanceTable', 'id = :id', { ':id': 'va-1' }, true)
    expect(provider.sendOnChain).toHaveBeenCalledTimes(swept ? 1 : 0)
    // A sweep that waits claims nothing: the next deposit's sweep takes these coins too
    expect(putItem).toHaveBeenCalledTimes(swept ? 1 : 0)
    expect(logged('log', 'SWEEP_WAITING')).toHaveLength(swept ? 0 : 1)
  })

  it('lets the send activate the address, and charges what the provider paid at the TRX price read', async () => {
    provider.sendOnChain.mockImplementationOnce(activatingWith({ provider: 'CatFee', sun: 1_200_000 }))
    expect(await handleSweep(deposit())).toBe(true)
    expect(provider.sendOnChain).toHaveBeenCalledWith(expect.objectContaining({ amount: '25', onActivated: expect.any(Function) }))
    // 1.2 TRX at 0.33
    expect(applyBalanceChangeOnce).toHaveBeenCalledWith({
      account: expect.objectContaining({ vAccountId: 'va-1' }), direction: 'DEBIT', amount: 0.396, currency: 'USDT_TRON',
      txId: `activation-${customerAddress}`, from: customerAddress, type: 'FEE',
    })
    expect(getFeeAccountId).toHaveBeenCalledWith('acme', 'USDT_TRON')
    expect(provider.transferFunds).toHaveBeenCalledWith({ senderAccountId: 'va-1', recipientAccountId: 'va-fee', amount: '0.396' })
    expect(logged('log', 'ACTIVATION_CHARGED')).toHaveLength(1)
  })

  it('charges for the activation even when the sweep then fails', async () => {
    provider.sendOnChain.mockImplementationOnce(activatingWith({ provider: 'TronSave', sun: 1_500_000 }, async () => { throw new Error('broadcast refused') }))
    expect(await handleSweep(deposit())).toBe(false)
    expect(applyBalanceChangeOnce).toHaveBeenCalledWith(expect.objectContaining({ amount: 0.495 }))
    expect(provider.transferFunds).toHaveBeenCalledWith(expect.objectContaining({ amount: '0.495' }))
    expect(logged('error', 'SWEEP_ERROR')).toHaveLength(1)
  })

  it('charges nothing more for an address already charged (two sweeps racing)', async () => {
    ;(applyBalanceChangeOnce as jest.Mock).mockResolvedValueOnce('duplicate')
    provider.sendOnChain.mockImplementationOnce(activatingWith({ provider: 'CatFee', sun: 1_200_000 }))
    expect(await handleSweep(deposit())).toBe(true)
    expect(provider.transferFunds).not.toHaveBeenCalled()
  })

  it.each([
    ['the FEE row is not written', () => (applyBalanceChangeOnce as jest.Mock).mockResolvedValueOnce('failed')],
    ['the merchant has no fee VA', () => (getFeeAccountId as jest.Mock).mockResolvedValueOnce(null)],
  ])('moves nothing in Tatum, and logs it to be settled by hand, when %s', async (_, failure) => {
    failure()
    provider.sendOnChain.mockImplementationOnce(activatingWith({ provider: 'CatFee', sun: 1_200_000 }))
    expect(await handleSweep(deposit())).toBe(true)
    expect(provider.transferFunds).not.toHaveBeenCalled()
    expect(logged('error', 'CRITICAL FEE_UNSETTLED')).toHaveLength(1)
  })

  it('logs a fee Tatum refused to move, but the sweep goes on', async () => {
    provider.transferFunds.mockRejectedValueOnce(new Error('Tatum 403: insufficient balance'))
    provider.sendOnChain.mockImplementationOnce(activatingWith({ provider: 'CatFee', sun: 1_200_000 }))
    expect(await handleSweep(deposit())).toBe(true)
    expect(logged('error', 'CRITICAL FEE_UNSETTLED')).toHaveLength(1)
    expect(logged('log', 'SWEEP_SUCCESS')).toHaveLength(1)
  })

  it.each([
    ['the TRX price', () => (fetchCryptoPrice as jest.Mock).mockRejectedValueOnce(new Error('EXCHANGE_RATE: Price not available for TRXUSDT'))],
    ['the balance', () => (queryRecord as jest.Mock).mockResolvedValueOnce({ success: false, res: null })],
    ['whether the address is active', () => (isTronAccountActive as jest.Mock).mockRejectedValueOnce(new Error('node timeout'))],
  ])('neither claims nor sweeps when it cannot read %s', async (_, failure) => {
    failure()
    expect(await handleSweep(deposit())).toBe(false)
    expect(putItem).not.toHaveBeenCalled()
    expect(provider.sendOnChain).not.toHaveBeenCalled()
    expect(logged('error', 'SWEEP_ERROR')).toHaveLength(1)
  })
})
