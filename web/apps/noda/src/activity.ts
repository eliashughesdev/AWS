// What the UI shows for each `type` in the backend's transaction log.
import type { AccountTransaction } from '@loudibly/core/composables/useTransactions'

export type ActivityStatus = 'Completed' | 'Pending' | 'Failed'

export interface ActivityKind {
  label: string
  // Where a row has room for more than the label: the Dashboard's Recent Activity.
  name?: string
  incoming: boolean
  status: ActivityStatus
}

const kinds: Record<string, ActivityKind> = {
  DEPOSIT:              { label: 'Deposit',  incoming: true,  status: 'Completed' },
  // Rows the backend no longer writes.
  DEPOSIT_FAILED:       { label: 'Deposit',  incoming: true,  status: 'Failed' },
  // Written once the transaction was broadcast. Whether the chain confirmed it is not tracked.
  WITHDRAWAL:           { label: 'Withdraw', incoming: false, status: 'Completed' },
  // The amount went back to the account.
  WITHDRAWAL_FAILED:    { label: 'Withdraw', incoming: false, status: 'Failed' },
  // Whether it reached the chain is not known.
  WITHDRAWAL_UNCERTAIN: { label: 'Withdraw', incoming: false, status: 'Pending' },
  // Not in Figma: a transfer between two users.
  TRANSFER_RECEIVED:    { label: 'Transfer', incoming: true,  status: 'Completed' },
  TRANSFER_SENT:        { label: 'Transfer', incoming: false, status: 'Completed' },
}

// Not in Figma: a FEE row listed by itself.
const fee: ActivityKind = { label: 'Fee', name: 'Network fee', incoming: false, status: 'Completed' }

// undefined for a row that is not listed by itself: a FEE, and any type not known here.
export const activityKind = (type: string): ActivityKind | undefined => kinds[type]

// The same for a list of rows, where a FEE row can be listed. One that shares its account and chain
// transaction with a listed row (a withdrawal) is shown in that row's Fee column. One with no such
// row, mostly the fee of moving a deposit to the merchant's master, is listed by itself, unless the
// chain charged nothing, as it does for an address's first sweeps of the day.
export function activityKinds(rows: AccountTransaction[]): (tx: AccountTransaction) => ActivityKind | undefined {
  const owned = new Set(rows.filter(tx => kinds[tx.type] && tx.txId).map(tx => `${tx.accountNo}:${tx.txId}`))
  return tx => {
    if (tx.type !== 'FEE') return kinds[tx.type]
    return owned.has(`${tx.accountNo}:${tx.txId}`) || !(Number(tx.amount) > 0) ? undefined : fee
  }
}
