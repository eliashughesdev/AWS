import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import bs58 from 'bs58'
import type { OnChainTx } from './types'

const LAMPORTS_PER_SOL = 1_000_000_000
const MAX_HISTORY_TXS = 100

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

// Key-based sign-in: the address is derived from the key locally, nothing is sent.
export function deriveSolanaAddress(privateKey: string): string {
  try {
    return Keypair.fromSecretKey(bs58.decode(privateKey.trim())).publicKey.toBase58()
  } catch {
    throw new Error('Invalid private key')
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

/**
 * Native SOL balance from the public RPC — no API key. An address that has never
 * been funded simply reads as zero rather than erroring.
 */
export async function getSolanaBalance(address: string): Promise<number> {
  const lamports = await getConnection().getBalance(new PublicKey(address))
  return lamports / LAMPORTS_PER_SOL
}

/**
 * Transaction history straight from the public Solana RPC — no API key, no backend.
 * Solana has no history-by-address endpoint, so we walk getSignaturesForAddress +
 * getParsedTransactions. The amount is the net lamport delta of the watched address
 * (so outgoing amounts include the fee). Native SOL only — SPL transfers move token
 * accounts, not the watched address's lamports.
 */
export async function getSolanaHistory(address: string, limit = MAX_HISTORY_TXS): Promise<OnChainTx[]> {
  const connection = getConnection()
  const watched = new PublicKey(address)

  const signatures = await connection.getSignaturesForAddress(watched, { limit })
  const confirmed = signatures.filter(s => !s.err).map(s => s.signature)
  if (confirmed.length === 0) return []

  const txs = await connection.getParsedTransactions(confirmed, { maxSupportedTransactionVersion: 0 })

  const out: OnChainTx[] = []
  for (const tx of txs) {
    if (!tx?.meta) continue

    const keys = tx.transaction.message.accountKeys
    const idx = keys.findIndex(k => k.pubkey.equals(watched))
    if (idx === -1) continue

    const delta = (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) / LAMPORTS_PER_SOL
    if (delta === 0) continue

    // Counterparty: the account with the largest opposite-signed lamport delta.
    let counter: string | undefined
    let counterDelta = 0
    for (let i = 0; i < keys.length; i++) {
      if (i === idx) continue
      const d = tx.meta.postBalances[i] - tx.meta.preBalances[i]
      if (Math.sign(d) === -Math.sign(delta) && Math.abs(d) > Math.abs(counterDelta)) {
        counter = keys[i].pubkey.toBase58()
        counterDelta = d
      }
    }

    out.push({
      txId: tx.transaction.signatures[0],
      amount: delta,
      currency: 'SOL',
      from: delta < 0 ? address : counter,
      to: delta < 0 ? counter : address,
      blockNumber: tx.slot,
      timestamp: tx.blockTime ? tx.blockTime * 1000 : undefined,
    })
  }
  return out
}

