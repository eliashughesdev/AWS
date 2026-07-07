import axios from 'axios'
import { Connection, PublicKey } from '@solana/web3.js'
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
