import axios from 'axios'
import { Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { OnChainTransaction } from '../../provider'

const LAMPORTS_PER_SOL = 1_000_000_000

// Backfill depth cap: one wallet import doesn't need the full chain history —
// the balance is seeded from the on-chain snapshot, history rows are display-only.
const MAX_HISTORY_TXS = 100

// Read lazily (not as module-level consts) — loadConfig() refreshes these from
// SSM at request time, after this module has already been imported at cold start.
function resolveBase(): string {
  return process.env.TATUM_BASE_URL || 'https://api.tatum.io/v3'
}

// Tatum's node proxy follows the API key's network (devnet/mainnet), same
// gateway the withdrawal flow already uses for build/broadcast.
function rpcConnection(): Connection {
  return new Connection(`${resolveBase()}/blockchain/node/SOL`, {
    httpHeaders: { 'x-api-key': process.env.TATUM_API_KEY! },
  })
}

// GET /v3/solana/account/balance/{address} — native SOL only, already in SOL.
export async function getSolanaBalance(address: string): Promise<number> {
  const url = `${resolveBase()}/solana/account/balance/${address}`
  const res = await axios.get(url, { headers: { 'x-api-key': process.env.TATUM_API_KEY } })
  return Number(res.data?.balance ?? 0)
}

// Solana has no REST history-by-address endpoint (unlike TRON), so we walk
// getSignaturesForAddress + getParsedTransactions over the RPC node. The
// amount is the net lamport delta of the watched address (pre/post balances),
// so outgoing amounts include the fee. Native SOL only — SPL transfers move
// token accounts, not the watched address's lamports.
export async function getSolanaHistory(address: string): Promise<OnChainTransaction[]> {
  const connection = rpcConnection()
  const watched = new PublicKey(address)

  const signatures = await connection.getSignaturesForAddress(watched, { limit: MAX_HISTORY_TXS })
  const confirmed = signatures.filter(s => !s.err).map(s => s.signature)
  if (confirmed.length === 0) return []

  const txs = await connection.getParsedTransactions(confirmed, { maxSupportedTransactionVersion: 0 })

  const results: OnChainTransaction[] = []
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

    results.push({
      txId: tx.transaction.signatures[0],
      amount: delta,
      currency: 'SOL',
      from: delta < 0 ? address : counter,
      to: delta < 0 ? counter : address,
      blockNumber: tx.slot,
      timestamp: tx.blockTime ? tx.blockTime * 1000 : undefined,
    })
  }
  return results
}

// The lamports an account with no data must hold: a transfer that would leave an
// account between 0 and this is refused
export async function getSolanaRentExemptMinimum(): Promise<number> {
  return rpcConnection().getMinimumBalanceForRentExemption(0)
}

// A v0 message, the shape Tatum's node accepts (see tatum.ts)
function transferMessage(from: PublicKey, to: PublicKey, lamports: number, blockhash: string) {
  return new TransactionMessage({
    payerKey: from,
    recentBlockhash: blockhash,
    instructions: [SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports })],
  }).compileToV0Message()
}

export interface SolanaSweep {
  tx: VersionedTransaction
  amountLamports: number
  feeLamports: number
}

// The unsigned transaction that sends from's whole balance minus the fee the node
// quotes for it (5000 lamports per signature) to `to`, leaving 0. The fee depends
// on the signatures, not the amount, so one quote serves. null when the balance
// can't pay the fee.
export async function buildSolanaSweep(from: string, to: string): Promise<SolanaSweep | null> {
  const connection = rpcConnection()
  const fromPubkey = new PublicKey(from)
  const toPubkey = new PublicKey(to)
  const [balance, { blockhash }] = await Promise.all([
    connection.getBalance(fromPubkey, 'confirmed'), connection.getLatestBlockhash(),
  ])

  const { value: feeLamports } = await connection.getFeeForMessage(transferMessage(fromPubkey, toPubkey, balance, blockhash))
  if (feeLamports === null) throw new Error(`Solana node quoted no fee for a sweep of ${from}`)
  if (balance <= feeLamports) return null

  const amountLamports = balance - feeLamports
  return { tx: new VersionedTransaction(transferMessage(fromPubkey, toPubkey, amountLamports, blockhash)), amountLamports, feeLamports }
}

// The SOL the chain charged for a transaction, or null until it is confirmed
export async function getSolanaTransactionFee(signature: string): Promise<number | null> {
  const tx = await rpcConnection().getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
  return tx?.meta ? tx.meta.fee / LAMPORTS_PER_SOL : null
}
