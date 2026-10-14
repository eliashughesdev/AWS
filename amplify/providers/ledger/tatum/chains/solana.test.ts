import { Connection, Keypair, SystemInstruction } from '@solana/web3.js'
import { buildSolanaSweep, getSolanaRentExemptMinimum, getSolanaTransactionFee } from './solana'

const from = Keypair.generate().publicKey
const to = Keypair.generate().publicKey
const blockhash = Keypair.generate().publicKey.toBase58()

const rpc = (method: keyof Connection) => jest.spyOn(Connection.prototype, method as any)

describe('buildSolanaSweep', () => {
  beforeEach(() => {
    rpc('getLatestBlockhash').mockResolvedValue({ blockhash, lastValidBlockHeight: 1 })
    rpc('getFeeForMessage').mockResolvedValue({ context: { slot: 1 }, value: 5000 })
  })

  it('sends the balance minus the quoted fee, leaving 0', async () => {
    rpc('getBalance').mockResolvedValue(1_000_000)
    const sweep = await buildSolanaSweep(from.toBase58(), to.toBase58())

    expect(sweep).toMatchObject({ amountLamports: 995_000, feeLamports: 5000 })
    const message = sweep!.tx.message
    const transfer = SystemInstruction.decodeTransfer({
      programId: message.staticAccountKeys[message.compiledInstructions[0].programIdIndex],
      keys: message.compiledInstructions[0].accountKeyIndexes.map(i => ({ pubkey: message.staticAccountKeys[i], isSigner: false, isWritable: true })),
      data: Buffer.from(message.compiledInstructions[0].data),
    })
    expect(transfer).toEqual({ fromPubkey: from, toPubkey: to, lamports: 995_000n })
    expect(message.recentBlockhash).toBe(blockhash)
  })

  it('is null when the balance cannot pay the fee', async () => {
    rpc('getBalance').mockResolvedValue(5000)
    expect(await buildSolanaSweep(from.toBase58(), to.toBase58())).toBeNull()
  })

  it('throws when the node quotes no fee', async () => {
    rpc('getBalance').mockResolvedValue(1_000_000)
    rpc('getFeeForMessage').mockResolvedValue({ context: { slot: 1 }, value: null })
    await expect(buildSolanaSweep(from.toBase58(), to.toBase58())).rejects.toThrow(/quoted no fee/)
  })
})

describe('getSolanaRentExemptMinimum', () => {
  it('asks for an account with no data', async () => {
    const minimum = rpc('getMinimumBalanceForRentExemption').mockResolvedValue(650_240)
    expect(await getSolanaRentExemptMinimum()).toBe(650_240)
    expect(minimum).toHaveBeenCalledWith(0)
  })
})

describe('getSolanaTransactionFee', () => {
  it('reads meta.fee of the confirmed transaction', async () => {
    const read = rpc('getTransaction').mockResolvedValue({ meta: { fee: 5000 } } as any)
    expect(await getSolanaTransactionFee('sig')).toBe(0.000005)
    expect(read).toHaveBeenCalledWith('sig', { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
  })

  it('is null until it is confirmed', async () => {
    rpc('getTransaction').mockResolvedValue(null)
    expect(await getSolanaTransactionFee('sig')).toBeNull()
  })
})
