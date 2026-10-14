import { TatumProvider } from './tatum'
import { getTronTransactionFee } from './chains/tron'
import { getSolanaTransactionFee } from './chains/solana'

jest.mock('./chains/tron', () => ({ getTronTransactionFee: jest.fn(async () => 0.268) }))
jest.mock('./chains/solana', () => ({ getSolanaTransactionFee: jest.fn(async () => 0.000005) }))

describe('TatumProvider.getTransactionFee', () => {
  const provider = new TatumProvider()

  it.each([
    ['TRON', 0.268],
    ['USDT_TRON', 0.268],
    ['SOL', 0.000005],
  ])('reads a %s transaction on its network', async (chain, fee) => {
    expect(await provider.getTransactionFee({ chain, txId: 'tx-1' })).toBe(fee)
  })

  it('asks the chain by the transaction id', async () => {
    await provider.getTransactionFee({ chain: 'TUSDT_TRON', txId: 'tx-1' })
    await provider.getTransactionFee({ chain: 'sol', txId: 'sig-1' })
    expect(getTronTransactionFee).toHaveBeenCalledWith('tx-1')
    expect(getSolanaTransactionFee).toHaveBeenCalledWith('sig-1')
  })

  it('refuses a currency of no known network', async () => {
    await expect(provider.getTransactionFee({ chain: 'BTC', txId: 'tx-1' })).rejects.toThrow(/unsupported chain BTC/)
  })
})
