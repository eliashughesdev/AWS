// What the UI shows for each `type` in the backend's transaction log.

export type ActivityStatus = 'Completed' | 'Pending' | 'Failed'

export interface ActivityKind {
  label: string
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

// undefined for a row that is not listed by itself: a FEE, which belongs to its withdrawal,
// and any type not known here.
export const activityKind = (type: string): ActivityKind | undefined => kinds[type]
