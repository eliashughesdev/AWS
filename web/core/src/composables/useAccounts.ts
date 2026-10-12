import { computed, onScopeDispose, ref } from 'vue'
import { createAccount, listAccounts } from '../api/accounts'
import { LEDGER_PROVIDER } from '../config'
import type { Account } from '../api/types'

const IMPORT_POLL_MS = 5000

// The signed-in user's custodial accounts.
export function useAccounts({ pollWhileImporting = false } = {}) {
  const accounts = ref<Account[]>([])
  const loading  = ref(true)
  // The server refused the first read, so the empty list is not the user's.
  const failed   = ref(false)
  // An account without a chain is a cash balance.
  const cryptoAccounts = computed(() => accounts.value.filter(a => !!a.chain))

  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  // First read. Throws when the request itself fails; what to show then is the view's call.
  async function load() {
    try {
      const { ok, data } = await listAccounts()
      failed.value   = !ok
      accounts.value = data.accounts ?? []
    } finally {
      loading.value = false
    }
    schedulePoll()
  }

  // Later reads keep the list on screen when the response carries none.
  async function reread() {
    const { data } = await listAccounts()
    accounts.value = data.accounts ?? accounts.value
  }

  async function refresh() {
    await reread()
    schedulePoll()
  }

  // Imported accounts backfill asynchronously (SQS) — re-read in the background
  // until every account has left 'importing' so the "Syncing…" badge clears
  // without the user having to reload the page.
  function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = null
    if (!pollWhileImporting || disposed) return
    if (!accounts.value.some(a => a.status === 'importing')) return
    pollTimer = setTimeout(async () => {
      pollTimer = null
      await reread().catch(e => console.error('Failed to refresh accounts', e))
      schedulePoll()
    }, IMPORT_POLL_MS)
  }

  onScopeDispose(() => {
    disposed = true
    if (pollTimer) clearTimeout(pollTimer)
  })

  // Sends the request only — the view decides what counts as success and re-reads the list.
  function create({ chain, accountName, email, userId }: {
    chain: string
    accountName: string
    email: string
    userId?: string
  }) {
    return createAccount({
      accountName,
      email,
      chain,
      provider: LEDGER_PROVIDER,
      accountingCurrency: 'USD',
      userId,
    })
  }

  return { accounts, cryptoAccounts, loading, failed, load, refresh, create }
}
