// Prepaid cards issued to our users (docs/card-issuing-plan.md). In the issuer's model a company is
// a tenant of our API key with one corporate balance, the only one funded from outside (a crypto
// top-up). A card account is a balance funded from it (load, unload) that cards spend from. A
// cardholder is the person; each card belongs to one cardholder and spends one card account.
// Amounts stay the decimal strings the issuer sends, in the currency given with them.

// 'refused': the issuer did nothing (code: its own error code, for the log only).
// 'unknown': no clear answer, so a create or a money move may have happened: find it again by
// listing, never send it again blindly. Reads can simply be retried.
export type CardOutcome<T> =
  | { status: 'done', value: T }
  | { status: 'refused', code?: number, reason: string }
  | { status: 'unknown', reason: string }

export type CardStatus = 'pending' | 'failed' | 'active' | 'frozen' | 'blocked' | 'expired' | 'deleted' | 'unknown'

export type CardAction = 'freeze' | 'unfreeze' | 'block'

export type PaymentStatus = 'authorized' | 'pending' | 'completed' | 'declined' | 'canceled' | 'failed' | 'unknown'

// 'waiting': the address is out, no coins yet
export type TopUpStatus = 'waiting' | 'processing' | 'completed' | 'failed' | 'refunded' | 'unknown'

export interface Money {
  amount: string
  currency?: string
}

export interface Cardholder {
  firstName: string
  lastName: string
  email: string
  // E.164; the issuer sends 3-D Secure codes to it
  phone: string
  // Ours (the user id), kept by the issuer so the record can be found again
  reference: string
}

export interface IssueCardRequest {
  cardholderId: string
  cardAccountId: string
  binId: string
  name: string
}

export interface IssuedCard {
  id: string
  // Not in a single card's details
  cardAccountId?: string
  cardholderId?: string
  name?: string
  // Not until the card is ready
  last4?: string
  // Lower case: visa, mastercard
  network?: string
  type: 'virtual' | 'physical'
  status: CardStatus
  expiry?: { month: number, year: number }
}

export interface Balance {
  available: string
  currency?: string
}

export interface Company {
  id: string
  name?: string
  active: boolean
}

// A short-lived page that shows the card's number to its holder without it passing through us
export interface CardReveal {
  url: string
  token: string
  expiresInSeconds?: number
}

// A purchase, refund or other movement made with a card
export interface CardPayment {
  id: string
  cardId?: string
  cardAccountId?: string
  last4?: string
  type?: string
  status: PaymentStatus
  // Negative for a debit, in the merchant's currency
  amount: Money
  // In the card account's currency
  settled?: Money
  fee?: Money
  merchant?: { name?: string, country?: string, mcc?: string }
  declineReason?: string
  at?: string
}

export type CardEvent =
  | { kind: 'payment', companyId?: string, payment: CardPayment }
  | { kind: 'card-state', companyId?: string, cardId: string, cardAccountId?: string, status: CardStatus }
  | { kind: 'top-up', companyId?: string, id: string, status: TopUpStatus, address?: string, currency?: string, amount?: string, fee?: Money, credited?: Money, txHash?: string }
  | { kind: 'balance-movement', companyId?: string, id: string, cardAccountId?: string, type: string, amount: Money, fee?: Money, at?: string }
  | { kind: 'unrecognized' }

export interface CardIssuer {
  getCompany(companyId: string): Promise<CardOutcome<Company>>
  // Signs every webhook of the company with this environment's secret
  setWebhookSecret(companyId: string): Promise<CardOutcome<void>>
  corporateBalance(companyId: string): Promise<CardOutcome<Balance>>

  createCardholder(companyId: string, holder: Cardholder): Promise<CardOutcome<string>>
  findCardholder(companyId: string, reference: string): Promise<CardOutcome<string | null>>

  // Its events go to this environment's webhook address
  createCardAccount(companyId: string, reference: string): Promise<CardOutcome<string>>
  findCardAccount(companyId: string, reference: string): Promise<CardOutcome<string | null>>
  cardAccountBalance(companyId: string, cardAccountId: string): Promise<CardOutcome<Balance>>
  // From the corporate balance to the card account, and back. At most 2 decimals, above 0
  load(companyId: string, cardAccountId: string, amount: string): Promise<CardOutcome<void>>
  unload(companyId: string, cardAccountId: string, amount: string): Promise<CardOutcome<void>>

  issueCard(companyId: string, request: IssueCardRequest): Promise<CardOutcome<string>>
  listCards(companyId: string, cardAccountId: string): Promise<CardOutcome<IssuedCard[]>>
  // 'not-ready': the issuer has not finished making the card; ask again shortly
  cardDetails(companyId: string, cardId: string): Promise<CardOutcome<IssuedCard> | { status: 'not-ready' }>
  changeCard(companyId: string, cardId: string, action: CardAction): Promise<CardOutcome<void>>
  cardPayments(companyId: string, cardId: string): Promise<CardOutcome<CardPayment[]>>
  revealCard(companyId: string, cardId: string): Promise<CardOutcome<CardReveal>>

  // Over the body exactly as received
  verifyWebhook(rawBody: string | undefined, signature: string | undefined, now?: number): boolean
  parseWebhook(body: unknown): CardEvent
}
