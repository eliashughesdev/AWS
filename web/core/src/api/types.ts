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

// An API key as /accounts/api-keys/list and the staff list answer it: never its secret or hash.
export interface ApiKey {
  // lk_live_ and 16 hex digits; with the secret it is the key's Basic credential.
  keyId: string
  name: string
  ownerType: 'user' | 'merchant'
  // The user's id, or the merchant's.
  ownerId: string
  merchantId: string
  permissions: string[]
  // `revoked` keys stay listed. An expired key is still `active`: compare expiresAt.
  status: 'active' | 'revoked'
  rateLimit?: { perSecond: number }
  // Empty: any IP.
  ipAllowlist: string[]
  expiresAt: string | null
  createdAt: string
  createdBy: string
  lastUsedAt: string | null
  revokedAt: string | null
  revokedBy: string | null
  revokeReason: string | null
}

// How the key screens group permissions (amplify/service/permissions.ts): `view` is ticked on a
// new key, `move-money` may need a verified identity when the key is used, `users` is a merchant's.
export type ApiKeyPermissionGroup = 'view' | 'manage' | 'move-money' | 'users'

export interface ApiKeyPermission {
  name: string
  // The backend's English description; a view may show its own wording instead.
  description: string
  group: ApiKeyPermissionGroup
}

// What a new key is made with. ipAllowlist empty or left out: any IP.
export interface NewApiKey {
  name: string
  permissions: string[]
  expiresAt?: string
  ipAllowlist?: string[]
}
