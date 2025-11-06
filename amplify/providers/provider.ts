export interface CreateAccountParams {
  userId: string
  currency: string
  xpub: string
}

export interface CreateAccountResponse {
  accountId: string
}

export interface GetBalanceResponse {
  balance: number
}

export interface TransferFundsParams {
  senderAccountId: string
  recipientAccountId: string
  amount: string
}

export interface TransferFundsResponse {
  reference: string
}

export interface CustomerAccount {
  id: string
  currency: string
  balance: string
  availableBalance: string
  frozenBalance: string
  active: boolean
  customerId: string
  accountCode?: string
  accountNumber?: string
  xpub?: string
  derivationKey?: number
  accountingCurrency?: string
  alias?: string
  created?: number
  frozen?: boolean
}


export interface AccountProvider {
  getXpub(chainName: string): Promise<{xpub: string}>
  createVaAccount(params: { userId: string; currency: string, xpub: string }): Promise<{ accountId: string }>;
  getCustomerAccounts(accountId: string): Promise<{ accounts: CustomerAccount[] }>;
  transferFunds(params: TransferFundsParams): Promise<{ reference: string }>;
  generateDepositAddress(accountId: string): Promise<{ address: string }>
}
