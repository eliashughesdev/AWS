import { computed, onScopeDispose, ref } from 'vue'
import { readWallet, READ_TTL_MS, type WalletRead } from '../wallet/reads'
import { useWalletSession } from '../wallet/session'

// Balance and history of every wallet in the session, read straight from the chains.
export function useWalletReads({ poll = false } = {}) {
  const session = useWalletSession()

  const reads       = ref<WalletRead[]>([])
  const loading     = ref(true)
  const failed      = ref(false)
  const lastUpdated = ref<number | null>(null)

  // Every transaction with its chain, newest first. The chains only return the most
  // recent window of history (100 txs). Anything older lives on-chain and is not
  // mirrored here — nothing is stored server-side.
  const history = computed(() =>
    reads.value
      .flatMap(r => r.transactions.map(tx => ({ tx, chain: r.chain })))
      .sort((a, b) => (b.tx.timestamp ?? 0) - (a.tx.timestamp ?? 0)),
  )

  // The chain is the source of truth — nothing is stored server-side, so every
  // refresh re-reads it. readWallet() collapses this to one network round trip per
  // address per TTL; `force` skips the cache for an explicit user refresh.
  async function refresh(force = false) {
    if (session.wallets.value.length === 0) return
    failed.value = false
    try {
      reads.value = await Promise.all(
        session.wallets.value.map(w => readWallet(w.chain, w.address, force)),
      )
      lastUpdated.value = Date.now()
    } catch (e) {
      failed.value = true
      console.error('Failed to read wallets', e)
    } finally {
      loading.value = false
    }
  }

  // Poll on the TTL cadence: activity from any other wallet or platform shows up
  // within one TTL. No subscription, no websocket — nothing to tie to an identity.
  let pollTimer: ReturnType<typeof setInterval> | null = null

  // First read. With `poll`, keeps re-reading until the page is left.
  function load() {
    if (pollTimer) clearInterval(pollTimer)
    if (poll) pollTimer = setInterval(() => refresh(), READ_TTL_MS)
    return refresh()
  }

  onScopeDispose(() => {
    if (pollTimer) clearInterval(pollTimer)
  })

  return { reads, history, loading, failed, lastUpdated, load, refresh }
}
