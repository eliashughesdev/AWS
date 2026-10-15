// The fields the UI reads, not the full backend payloads. Optional where an
// error response or an empty body leaves them missing.

// Whether each money operation needs the user's identity verified, as the account's merchant set
// it (the backend's KYC policy; an operation nobody switched off needs it).
export interface KycSwitches {
  withdraw: boolean
  transfer: boolean
  cardDeposit: boolean
}

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
  // Missing from a backend older than the KYC policy, which checked nothing.
  kycRequired?: KycSwitches
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
  // By ledger currency, every one the backend knows.
  kycRequired?: Record<string, KycSwitches>
}
