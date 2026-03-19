export interface CreateAccountParams {
  userId: string
  currency: string
  xpub?: string
  address?: string
  accountingCurrency: string
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

export interface AssignDepositAddressParams {
  accountId: string;
  address: string;
}

export interface AssignDepositAddressResponse {
  address: string;
}

export interface GenerateDepositAddressResponse {
  xpub: string;
  derivationKey: number;
  address: string;
  currency: string;
}


export interface WithdrawFundsParams {
  accountId: string
  address: string
  amount: string
  currency: string
  signatureId: string
  senderAddress: string
}

export interface WithdrawFundsResponse {
  withdrawalId: string
}

export interface CreateSubscriptionParams {
  accountId: string
  chain: string
  webhookUrl: string
}

export interface CreateSubscriptionResponse {
  subscriptionId: string
}

export interface AccountProvider {
  getXpub(chainName: string): Promise<{ xpub: string }>
  createVaAccount(params: CreateAccountParams): Promise<{ accountId: string }>;
  getCustomerAccounts(accountId: string): Promise<{ accounts: CustomerAccount[] }>;
  transferFunds(params: TransferFundsParams): Promise<{ reference: string }>;
  generateDepositAddress(accountId: string): Promise<GenerateDepositAddressResponse>;
  assignDepositAddress(params: AssignDepositAddressParams): Promise<AssignDepositAddressResponse>;
  createSubscription(params: CreateSubscriptionParams): Promise<CreateSubscriptionResponse>;
  withdrawFunds(params: WithdrawFundsParams): Promise<WithdrawFundsResponse>;
}
