import { ref } from 'vue'
import { listTransactions } from '../api/accounts'
import type { Account, Transaction } from '../api/types'

// The endpoint is queried once per account and its rows don't say which account
// they belong to, so each one is tagged with the account it was listed for.
export type AccountTransaction = Transaction & { accountNo: string }

export function useTransactions() {
  const transactions = ref<AccountTransaction[]>([])
  const loading      = ref(true)
  // An account's rows could not be read, so the list may be missing some.
  const failed       = ref(false)
  let lastCall = 0

  // Newest first across the given accounts. An account whose request fails counts as empty.
  async function load(accounts: Account[], { limit }: { limit?: number } = {}) {
    const call = ++lastCall
    loading.value = true
    let incomplete = false
    const lists = await Promise.all(
      accounts.map(({ accountNo }) =>
        listTransactions(accountNo)
          .then(r => {
            if (!r.ok) incomplete = true
            return (r.data.transactions ?? []).map(tx => ({ ...tx, accountNo }))
          })
          .catch((): AccountTransaction[] => {
            incomplete = true
            return []
          })
      )
    )
    // A later call (another account was picked meanwhile) owns the result.
    if (call !== lastCall) return
    const newestFirst = lists
      .flat()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    transactions.value = limit ? newestFirst.slice(0, limit) : newestFirst
    failed.value  = incomplete
    loading.value = false
  }

  return { transactions, loading, failed, load }
}
