import type { Chain, OnChainTx } from './types'
import { getTronBalance, getTronHistory } from './tron'
import { getSolanaBalance, getSolanaHistory } from './solana'

export interface WalletRead {
  chain: Chain
  address: string
  balance: number
  transactions: OnChainTx[]
}

// The chain is the source of truth: the user can transact from any wallet on any
// platform, so nothing is persisted. This cache only bounds how often we hit the
// public nodes — an entry older than TTL_MS is refetched, so activity from
// elsewhere surfaces within one TTL. bust() clears an address right after the
// user's own send, so they never wait out the TTL to see their own action.
export const READ_TTL_MS = 30_000

const cache = new Map<string, { at: number; read: Promise<WalletRead> }>()

export function bust(address: string) {
  cache.delete(address)
}

export function bustAll() {
  cache.clear()
}

async function fetchWallet(chain: Chain, address: string): Promise<WalletRead> {
  const [balance, transactions] = await Promise.all([
    chain === 'SOL' ? getSolanaBalance(address) : getTronBalance(address),
    chain === 'SOL' ? getSolanaHistory(address) : getTronHistory(address),
  ])
  return { chain, address, balance, transactions }
}

// Caching the promise (not the resolved value) also collapses concurrent reads of
// the same address into one network round trip.
export function readWallet(chain: Chain, address: string, force = false): Promise<WalletRead> {
  const hit = cache.get(address)
  if (!force && hit && Date.now() - hit.at < READ_TTL_MS) return hit.read

  const read = fetchWallet(chain, address).catch(e => {
    cache.delete(address)
    throw e
  })
  cache.set(address, { at: Date.now(), read })
  return read
}
