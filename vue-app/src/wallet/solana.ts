import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import bs58 from 'bs58'

const LAMPORTS_PER_SOL = 1_000_000_000

// Must match the network the backend/Tatum subscriptions run on. Defaults to
// Solana devnet; set VITE_SOLANA_NETWORK=mainnet for production.
function resolveSolanaEndpoint(): string {
  return import.meta.env.VITE_SOLANA_NETWORK === 'mainnet'
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com'
}

function getConnection(): Connection {
  return new Connection(resolveSolanaEndpoint(), 'confirmed')
}

export interface SolanaWallet {
  address: string
  privateKey: string
}

export function generateSolanaWallet(): SolanaWallet {
  const keypair = Keypair.generate()
  return {
    address: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey),
  }
}

function describeSolanaError(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    if (typeof o.message === 'string') return o.message
    return JSON.stringify(e)
  }
  return String(e)
}

export async function sendSolanaTransaction(privateKey: string, to: string, amount: string): Promise<string> {
  let keypair: Keypair
  try {
    keypair = Keypair.fromSecretKey(bs58.decode(privateKey.trim()))
  } catch {
    throw new Error('Invalid private key')
  }

  let toPubkey: PublicKey
  try {
    toPubkey = new PublicKey(to.trim())
  } catch {
    throw new Error('Invalid destination address')
  }

  const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL)
  if (!Number.isFinite(lamports) || lamports <= 0) throw new Error('Invalid amount')

  try {
    const connection = getConnection()
    const { blockhash } = await connection.getLatestBlockhash()

    const messageV0 = new TransactionMessage({
      payerKey: keypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey, lamports }),
      ],
    }).compileToV0Message()

    const tx = new VersionedTransaction(messageV0)
    tx.sign([keypair])

    return await connection.sendRawTransaction(tx.serialize())
  } catch (e) {
    console.error('sendSolanaTransaction failed:', e)
    throw new Error(describeSolanaError(e))
  }
}

export interface SolanaTokenBalance {
  asset: string
  balance: string
  decimals?: number
  type: string
}

export interface SolanaAccountDetails {
  address: string
  native: SolanaTokenBalance | null
  tokens: SolanaTokenBalance[]
  raw: SolanaTokenBalance[]
}

/**
 * Fetches the native SOL balance for an address. Works for non-custodial accounts
 * since they are just plain Solana addresses. Shaped like TronAccountDetails so
 * callers can stay symmetric across chains.
 */
export async function getSolanaAccountDetails(address: string): Promise<SolanaAccountDetails> {
  const connection = getConnection()
  const lamports = await connection.getBalance(new PublicKey(address))
  const native: SolanaTokenBalance = {
    asset: 'SOL',
    balance: (lamports / LAMPORTS_PER_SOL).toString(),
    decimals: 9,
    type: 'native',
  }
  return { address, native, tokens: [], raw: [native] }
}
