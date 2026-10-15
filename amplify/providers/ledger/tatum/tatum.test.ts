import axios from 'axios'
import { Connection, Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { TatumProvider } from './tatum'
import { buildTronSweep, getTronTransactionFee, isTronAccountActive } from './chains/tron'
import { buildSolanaSweep, getSolanaTransactionFee, isSolanaRentExempt } from './chains/solana'
import { signSol, signTron } from '../../../utils/signing'

jest.mock('./chains/tron', () => ({ getTronTransactionFee: jest.fn(async () => 0.268), buildTronSweep: jest.fn(), isTronAccountActive: jest.fn() }))
jest.mock('./chains/solana', () => ({ getSolanaTransactionFee: jest.fn(async () => 0.000005), buildSolanaSweep: jest.fn(), isSolanaRentExempt: jest.fn() }))
jest.mock('../../../utils/signing', () => ({ signTron: jest.fn(async () => 'sig'), signSol: jest.fn(async () => 'ab'.repeat(64)) }))
jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn(), put: jest.fn(), delete: jest.fn(), isAxiosError: () => false } }))

// Tatum's ledger and TRON node as withdrawFunds and debitFee call them
const created = () => (axios.post as jest.Mock).mock.calls.filter(([url]) => url.endsWith('/offchain/withdrawal')).map(([, payload]) => payload)
const completed = () => (axios.put as jest.Mock).mock.calls.map(([url]) => url.split('/offchain/withdrawal/')[1])

beforeEach(() => {
  let withdrawals = 0
  ;(axios.post as jest.Mock).mockImplementation(async (url: string) => {
    if (url.endsWith('/offchain/withdrawal')) return { data: { id: `wd-${++withdrawals}` } }
    if (url.endsWith('/wallet/createtransaction')) return { data: { txID: 'tx-1', raw_data_hex: '00' } }
    if (url.endsWith('/tron/broadcast')) return { data: { txId: 'tx-1' } }
    throw new Error(`unexpected POST ${url}`)
  })
  ;(axios.put as jest.Mock).mockResolvedValue({ data: {} })
})

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

describe('TatumProvider.withdrawFunds: the fee Tatum records', () => {
  const provider = new TatumProvider()
  const withdraw = (currency: string, masterAccountId?: string) => provider.withdrawFunds({
    accountId: 'va-1', address: 'TDestination', amount: '25', currency, key: { accountNo: 'PCF0001' }, senderAddress: 'TSender', masterAccountId,
  })

  it('holds back its fixed fee when a native coin is sent from the customer\'s own address', async () => {
    await withdraw('TRON')
    expect(created()).toEqual([expect.objectContaining({ senderAccountId: 'va-1', amount: '25', fee: '1' })])
  })

  // native-sweep-plan step 2: the real fee is read from the receipt afterwards (debitFee)
  it('records no fee on either debit when a master sends a native coin', async () => {
    const result = await withdraw('TRON', 'va-master')
    expect(created()).toEqual([
      expect.objectContaining({ senderAccountId: 'va-1', amount: '25', fee: '0' }),
      expect.objectContaining({ senderAccountId: 'va-master', amount: '25', fee: '0' }),
    ])
    expect(completed()).toEqual(['wd-1/tx-1', 'wd-2/tx-1'])
    expect(result).toEqual({ withdrawalId: 'wd-1', masterWithdrawalId: 'wd-2', txId: 'tx-1' })
  })
})

describe('TatumProvider.debitFee', () => {
  const provider = new TatumProvider()
  const debit = (amount: number, currency = 'TRON') => provider.debitFee({ accountId: 'va-1', address: 'TDestination', amount, currency, txId: 'tx-1' })

  it('takes the fee off the VA as a withdrawal completed with the transaction\'s id', async () => {
    expect(await debit(0.268)).toBe('wd-1')
    expect(created()).toEqual([{ senderAccountId: 'va-1', address: 'TDestination', amount: '0.268', currency: 'TRON', fee: '0' }])
    expect(completed()).toEqual(['wd-1/tx-1'])
  })

  it('writes a small SOL fee out in full, not as 5e-7', async () => {
    await debit(0.0000005, 'sol')
    expect(created()[0]).toEqual(expect.objectContaining({ amount: '0.0000005', currency: 'SOL' }))
  })

  it('names the withdrawal left pending when it cannot be completed', async () => {
    ;(axios.put as jest.Mock).mockRejectedValueOnce(new Error('Tatum 500'))
    await expect(debit(0.268)).rejects.toThrow('Fee withdrawal wd-1 on va-1 was created but not completed with tx-1')
  })
})

// native-sweep-plan step 3
describe('TatumProvider.sweepAll', () => {
  const provider = new TatumProvider()
  const key = { accountNo: 'PCF0001' }
  const broadcasts = () => (axios.post as jest.Mock).mock.calls.filter(([url]) => url.endsWith('/tron/broadcast')).map(([, payload]) => JSON.parse(payload.txData))

  it('signs and broadcasts the very TRON transaction the fee was computed for, touching no ledger', async () => {
    const tx = { txID: 'tx-1', raw_data_hex: '0a02' }
    ;(buildTronSweep as jest.Mock).mockResolvedValueOnce({ tx, amountSun: 149_499_178, feeSun: 268_000 })
    const swept = await provider.sweepAll({ chain: 'TRON', senderAddress: 'TCustomer', recipientAddress: 'TMaster', key })

    expect(buildTronSweep).toHaveBeenCalledWith('TCustomer', 'TMaster')
    expect(signTron).toHaveBeenCalledWith(key, tx)
    expect(broadcasts()).toEqual([{ ...tx, signature: ['sig'] }])
    expect(created()).toEqual([])
    expect(swept).toEqual({ txId: 'tx-1', amount: 149.499178, fee: 0.268 })
  })

  it('signs the Solana sweep\'s message as the sender and sends it to the node', async () => {
    const from = Keypair.generate().publicKey
    const to = Keypair.generate().publicKey
    const tx = new VersionedTransaction(new TransactionMessage({
      payerKey: from, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: 995_000 })],
    }).compileToV0Message())
    ;(buildSolanaSweep as jest.Mock).mockResolvedValueOnce({ tx, amountLamports: 995_000, feeLamports: 5000 })
    const send = jest.spyOn(Connection.prototype, 'sendRawTransaction').mockResolvedValueOnce('sig-1')

    const swept = await provider.sweepAll({ chain: 'SOL', senderAddress: from.toBase58(), recipientAddress: to.toBase58(), key })

    expect(signSol).toHaveBeenCalledWith(key, tx.message.serialize())
    const sent = VersionedTransaction.deserialize(send.mock.calls[0][0] as Buffer)
    expect(Buffer.from(sent.message.serialize())).toEqual(Buffer.from(tx.message.serialize()))
    expect(Buffer.from(sent.signatures[0]).toString('hex')).toBe('ab'.repeat(64))
    expect(swept).toEqual({ txId: 'sig-1', amount: 0.000995, fee: 0.000005 })
    send.mockRestore()
  })

  it('signs and sends nothing when the balance cannot pay the fee', async () => {
    ;(buildTronSweep as jest.Mock).mockResolvedValueOnce(null)
    expect(await provider.sweepAll({ chain: 'TRON', senderAddress: 'TCustomer', recipientAddress: 'TMaster', key })).toBeNull()
    expect(signTron).not.toHaveBeenCalled()
    expect(broadcasts()).toEqual([])
  })

  it('refuses a token, which is swept by its deposited amount (sendOnChain)', async () => {
    await expect(provider.sweepAll({ chain: 'USDT_TRON', senderAddress: 'TCustomer', recipientAddress: 'TMaster', key })).rejects.toThrow(/unsupported chain USDT_TRON/)
  })
})

describe('TatumProvider.canReceiveSweep', () => {
  const provider = new TatumProvider()

  it('asks whether a TRON address is active, and whether a Solana one is rent-exempt', async () => {
    ;(isTronAccountActive as jest.Mock).mockResolvedValueOnce(false)
    ;(isSolanaRentExempt as jest.Mock).mockResolvedValueOnce(true)
    expect(await provider.canReceiveSweep({ chain: 'TRON', address: 'TMaster' })).toBe(false)
    expect(await provider.canReceiveSweep({ chain: 'sol', address: 'SolMaster' })).toBe(true)
    expect(isTronAccountActive).toHaveBeenCalledWith('TMaster')
    expect(isSolanaRentExempt).toHaveBeenCalledWith('SolMaster')
  })

  it('refuses a currency it cannot sweep', async () => {
    await expect(provider.canReceiveSweep({ chain: 'USDT_TRON', address: 'TMaster' })).rejects.toThrow(/unsupported chain USDT_TRON/)
  })
})
