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
  kmsKeyId: string
  senderAddress: string
}

export interface WithdrawFundsResponse {
  withdrawalId: string
}

export interface CreateSubscriptionParams {
  accountId: string
  address: string
  chain: string
  webhookUrl: string
}

export interface CreateSubscriptionResponse {
  subscriptionId: string
}

export interface OnChainBalanceParams{
  chain: string
  address: string
}

export interface GetAddressHistoryParams {
  chain: string
  address: string
}

export interface OnChainTransaction {
  txId: string
  amount: number
  currency: string
  from?: string
  to?: string
  blockNumber?: number
  timestamp?: number
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
  getOnChainBalance(params: OnChainBalanceParams): Promise<number>;
  getAddressHistory(params: GetAddressHistoryParams): Promise<OnChainTransaction[]>
}
