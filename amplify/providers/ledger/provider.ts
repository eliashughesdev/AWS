import type { KeyRef } from '../../utils/signing'

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
  key: KeyRef
  senderAddress: string
  masterAccountId?: string
}

export interface WithdrawFundsResponse {
  withdrawalId: string
  masterWithdrawalId?: string
  txId: string
}

// The broadcast failed without a clear rejection, so the coins may have left:
// neither the ledger debits nor the app balance may be reverted automatically.
export class BroadcastUncertainError extends Error {
  constructor(public readonly withdrawalId: string, cause: unknown, public readonly masterWithdrawalId?: string) {
    super(`Broadcast outcome unknown for withdrawal ${withdrawalId}`, { cause })
    this.name = 'BroadcastUncertainError'
  }
}

export interface SendOnChainParams {
  chain: string
  senderAddress: string
  recipientAddress: string
  amount: string
  key: KeyRef
}

export interface SendOnChainResponse {
  txId: string
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

export interface TransactionFeeParams {
  chain: string
  txId: string
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
  cancelSubscription(subscriptionId: string): Promise<void>;
  removeDepositAddress(params: AssignDepositAddressParams): Promise<void>;
  deactivateVaAccount(accountId: string): Promise<void>;
  withdrawFunds(params: WithdrawFundsParams): Promise<WithdrawFundsResponse>;
  sendOnChain(params: SendOnChainParams): Promise<SendOnChainResponse>;
  getOnChainBalance(params: OnChainBalanceParams): Promise<number>;
  getVaBalance(accountId: string): Promise<{ accountBalance: number, availableBalance: number }>;
  getTransactionFee(params: TransactionFeeParams): Promise<number | null>;
  getAddressHistory(params: GetAddressHistoryParams): Promise<OnChainTransaction[]>
}
