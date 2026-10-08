// The fields the UI reads, not the full backend payloads. Optional where an
// error response or an empty body leaves them missing.

export interface Account {
  accountNo: string
  chain: string
  currency: string
  depositAddress: string
  status: string
  balance: number
  // What a withdrawal is checked against.
  availableBalance: number
}

export interface Transaction {
  type: string
  txId?: string
  reference?: string
  createdAt: string
  [field: string]: unknown
}

export interface SavedCard {
  id: string
  lastFour: string
  bin: string | null
  cardType: string
  createdAt: number
  isRecurringReady: boolean
}
