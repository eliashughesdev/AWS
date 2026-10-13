// The fields the UI reads, not the full backend payloads. Optional where an
// error response or an empty body leaves them missing.

export interface Account {
  accountNo: string
  // What its owner typed, or the account number when they typed nothing.
  name: string
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

export interface MerchantCurrency {
  currency: string
  // `provisioning` until /merchants/masters/provision finishes it, then `ready`.
  status: string
  depositAddress: string | null
}

export interface Merchant {
  merchantId: string
  name: string
  status: string
  accountingCurrency: string
  createdAt: string | null
  currencies: MerchantCurrency[]
}
