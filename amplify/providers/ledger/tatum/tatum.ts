import axios from 'axios'
import { CreateAccountParams,
  CreateAccountResponse, 
  AccountProvider,
  TransferFundsParams, 
  TransferFundsResponse, 
  CustomerAccount,
  AssignDepositAddressResponse, 
  AssignDepositAddressParams,
  GenerateDepositAddressResponse, 
  CreateSubscriptionParams,
  CreateSubscriptionResponse, 
  WithdrawFundsParams, WithdrawFundsResponse, BroadcastUncertainError,
  SendOnChainParams, SendOnChainResponse,
  GetAddressHistoryParams,
  OnChainBalanceParams,
  OnChainTransaction} from '../provider'
  import { getTronBalance, getTronHistory, estimateTrc20TransferEnergy, buildTrc20Transfer, estimateTronBandwidth } from './chains/tron'
  import { getSolanaBalance, getSolanaHistory } from './chains/solana'
import { Connection, PublicKey, SendTransactionError, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { signSol, signTron, type KeyRef } from '../../../utils/signing'
import { networkFor, isNativeCurrency, trc20ContractFor } from '../../../utils/currencies'
import { ensureEnergy, ensureBandwidth } from '../tronsave/tronsave'

export class TatumProvider implements AccountProvider {
  private readonly apiKey = process.env.TATUM_API_KEY
  private readonly TATUM_BASE_URL = process.env.TATUM_BASE_URL || 'https://api.tatum.io/v3'

  async createVaAccount({ userId, currency, xpub, accountingCurrency }: CreateAccountParams): Promise<CreateAccountResponse> {
    const url = `${this.TATUM_BASE_URL}/ledger/account`
    const payload = {
      currency,
      customer: { externalId: userId },
      xpub,
      accountingCurrency
    }

    console.log('DEBUG (TatumProvider): Calling createVaAccount.')
    console.log(`DEBUG (TatumProvider): POST URL: ${url}`)
    console.log(`DEBUG (TatumProvider): Payload: ${JSON.stringify(payload)}`)

    try {
      const res = await axios.post(url, payload,
        {
          headers: { 'x-api-key': this.apiKey }
        })

      console.log(`DEBUG (TatumProvider): Response status: ${res.status}. Account ID: ${res.data?.id}`)
      return { accountId: res.data.id }
    } catch (error) {
      console.error('ERROR (TatumProvider): Failed to create VA Account.', error)
      throw error // Re-throw to be caught by the calling handler
    }
  }

  async getCustomerAccounts(customerId: string): Promise<{ accounts: CustomerAccount[] }> {
    const url = `${this.TATUM_BASE_URL}/ledger/account/customer/${customerId}?pageSize=50`

    console.log('DEBUG (TatumProvider): Calling getCustomerAccounts.')
    console.log(`DEBUG (TatumProvider): GET URL: ${url}`)

    try {
      const res = await axios.get(
        url,
        {
          headers: { 'x-api-key': this.apiKey }
        }
      )

      console.log(`DEBUG (TatumProvider): Response status: ${res.status}. Accounts received: ${res.data?.length}`)
      return { accounts: res.data as CustomerAccount[] }
    } catch (error) {
      console.error('ERROR (TatumProvider): Failed to get customer accounts.', error)
      throw error
    }
  }


  async transferFunds({ senderAccountId, recipientAccountId, amount }: TransferFundsParams): Promise<TransferFundsResponse> {
    const url = `${this.TATUM_BASE_URL}/ledger/transaction`
    const payload = {
      senderAccountId,
      recipientAccountId,
      amount,
    }

    console.log('DEBUG (TatumProvider): Calling transferFunds.')
    console.log(`DEBUG (TatumProvider): POST URL: ${url}`)
    console.log(`DEBUG (TatumProvider): Payload: ${JSON.stringify(payload)}`)

    try {
      const res = await axios.post(url, payload, {
        headers: { 'x-api-key': this.apiKey }
      })

      console.log(`DEBUG (TatumProvider): Response status: ${res.status}. Transaction ID: ${res.data?.id}`)
      return { reference: res.data.id }
    } catch (err) {
      console.error('ERROR (TatumProvider): Failed to transfer funds.', err)
      throw err
    }
  }

  async getXpub(chaniName: string): Promise<{ xpub: string }> {
    // NOTE: This implementation returns a hardcoded placeholder.
    console.log('DEBUG (TatumProvider): Calling getXpub (Returning placeholder).')
    return { xpub: 'EXAMPLE_XPUB_FOR_ILUSTRATIVE_POUPOSES_REAL_ONE_SHOULD_COME_FROM_KMS' }
  }

  async generateDepositAddress(accountId: string): Promise<GenerateDepositAddressResponse> {
    const url = `${this.TATUM_BASE_URL}/offchain/account/${accountId}/address`

    console.log('DEBUG (TatumProvider): Calling generateDepositAddress.')
    console.log(`DEBUG (TatumProvider): POST URL: ${url}`)

    try {
      const response = await axios.post(
        url,
        {},
        {
          headers: {
            'x-api-key': process.env.TATUM_API_KEY!,
            'Content-Type': 'application/json',
          },
        }
      )

      console.log(`DEBUG (TatumProvider): Response status: ${response.status}. Generated address: ${response.data}`)
      return response.data as GenerateDepositAddressResponse
    } catch (error) {
      console.error('ERROR (TatumProvider): Failed to generate deposit address:', error)
      throw new Error('Unable to generate deposit address')
    }
  }

  // Maximum decimal places accepted by each chain.
  private readonly DECIMAL_PLACES: Record<string, number> = {
    TRON: 6,
    SOL: 9,
  }

  // Network fees required by Tatum's offchain withdrawal endpoint (in native currency).
  private readonly WITHDRAWAL_FEES: Record<string, string> = {
    TRON: '1',
    SOL: '0.000005',
  }

  // Chain-specific Tatum broadcast endpoints.
  // Used as the final step in the custom signing flow — submit externally-signed tx.
  private readonly BROADCAST_PATHS: Record<string, string> = {
    TRON: 'tron/broadcast',
    // SOL is broadcast directly via the Solana RPC node (see _broadcastTransaction).
  }

  // USDT on TRON (mainnet and the Shasta test stand-in) uses 6 decimals.
  private readonly TRC20_DECIMALS = 6

  // Ceiling on TRX the network may burn for a TRC-20 call — a safety cap, not a
  // charge: with ensureEnergy covering the call, nothing should be burned.
  // Matches energy-rental-test.ts's tested value.
  private readonly TRC20_FEE_LIMIT_SUN = 40_000_000

  /**
   * Withdraws funds from a Tatum virtual account to an on-chain address.
   *
   * Uses the custom signing mechanism — avoids Tatum KMS polling entirely:
   *   1. Create offchain withdrawal record in Tatum ledger (debits the VA)
   *   2. Build an unsigned blockchain transaction via Tatum's node proxy
   *   3. Sign the transaction with the sender's key (its KMS key or the HD signer)
   *   4. Broadcast the signed transaction via Tatum's broadcast endpoint
   *   5. Mark the withdrawal complete in Tatum's ledger
   */
  async withdrawFunds({ accountId, address, amount, currency, key, senderAddress, masterAccountId }: WithdrawFundsParams): Promise<WithdrawFundsResponse> {
    const chain = currency.toUpperCase()
    const decimals = this.DECIMAL_PLACES[chain] ?? 6
    const roundedAmount = parseFloat(amount).toFixed(decimals).replace(/\.?0+$/, '') || '0'

    console.log(`DEBUG (TatumProvider): withdrawFunds started. chain=${chain}, amount=${roundedAmount}, from=${senderAddress}, to=${address}`)

    // Step 1: Create withdrawal record — debits the VA. A token transfer's gas is
    // paid in rented TRX, so no token leaves as a fee and none is recorded.
    const fee = isNativeCurrency(chain) ? this.WITHDRAWAL_FEES[networkFor(chain) ?? chain] : '0'
    const withdrawalId = await this._createOffchainWithdrawal({ accountId, address, amount: roundedAmount, currency: chain, fee })
    console.log(`DEBUG (TatumProvider): Step 1 done — withdrawal record created. withdrawalId=${withdrawalId}`)

    let masterWithdrawalId: string | undefined
    if (masterAccountId) {
      try {
        masterWithdrawalId = await this._createOffchainWithdrawal({ accountId: masterAccountId, address, amount: roundedAmount, currency: chain, fee: '0' })
        console.log(`DEBUG (TatumProvider): Step 1b done — master VA debited. masterWithdrawalId=${masterWithdrawalId}`)
      } catch (err) {
        await this._cancelWithdrawal(withdrawalId)
        throw err
      }
    }
    const debits = masterWithdrawalId ? [withdrawalId, masterWithdrawalId] : [withdrawalId]

    // The debits are only reverted when the tx provably never reached the chain
    let broadcasting = false
    let txId: string
    try {
      // Steps 2 + 3: Build unsigned tx, sign it
      const signedTxData = await this._buildAndSignTransaction({ chain, senderAddress, recipientAddress: address, amount: roundedAmount, key })
      console.log(`DEBUG (TatumProvider): Steps 2+3 done — transaction built and signed.`)

      // Step 4: Broadcast the signed transaction via Tatum's broadcast endpoint
      broadcasting = true
      txId = await this._broadcastTransaction(chain, signedTxData)
      console.log(`DEBUG (TatumProvider): Step 4 done — transaction broadcast. txId=${txId}`)
    } catch (err) {
      if (broadcasting && !this._isBroadcastRejection(err)) {
        console.error(`CRITICAL (TatumProvider): broadcast outcome unknown, withdrawals ${debits.join(', ')} left pending — check the chain, then complete or cancel them manually`, err)
        throw new BroadcastUncertainError(withdrawalId, err, masterWithdrawalId)
      }
      for (const id of debits) await this._cancelWithdrawal(id)
      throw err
    }

    // Step 5: Mark the withdrawals complete in Tatum's ledger.
    for (const id of debits) {
      try {
        await this._completeWithdrawal(id, txId)
        console.log(`DEBUG (TatumProvider): Step 5 done — withdrawal marked complete. withdrawalId=${id}, txId=${txId}`)
      } catch (err) {
        console.error(`CRITICAL (TatumProvider): tx ${txId} was broadcast but withdrawal ${id} is not marked complete — complete it manually`, err)
      }
    }

    return { withdrawalId, masterWithdrawalId, txId }
  }

  /**
   * Moves already-custodied on-chain funds from one address to another,
   * signed by the given key — no Tatum ledger interaction. Unlike
   * withdrawFunds(), there is no virtual account to debit here: used for
   * internal treasury moves (e.g. sweeping a deposit to the master account)
   * where the customer's own balance was already credited separately and
   * must not be touched again.
   */
  async sendOnChain({ chain, senderAddress, recipientAddress, amount, key }: SendOnChainParams): Promise<SendOnChainResponse> {
    const normalizedChain = chain.toUpperCase()
    console.log(`DEBUG (TatumProvider): sendOnChain started. chain=${normalizedChain}, amount=${amount}, from=${senderAddress}, to=${recipientAddress}`)

    const signedTxData = await this._buildAndSignTransaction({ chain: normalizedChain, senderAddress, recipientAddress, amount, key })
    const txId = await this._broadcastTransaction(normalizedChain, signedTxData)

    console.log(`DEBUG (TatumProvider): sendOnChain broadcast. txId=${txId}`)
    return { txId }
  }

  /**
   * Step 1: Creates a pending withdrawal record in Tatum's offchain ledger.
   * Debits the virtual account balance atomically.
   */
  private async _createOffchainWithdrawal({ accountId, address, amount, currency, fee }: {
    accountId: string; address: string; amount: string; currency: string; fee?: string
  }): Promise<string> {
    const url = `${this.TATUM_BASE_URL}/offchain/withdrawal`
    const payload: Record<string, string> = { senderAccountId: accountId, address, amount, currency }
    if (fee) payload.fee = fee
    console.log(`DEBUG (TatumProvider): POST ${url}`)
    const res = await axios.post(url, payload, { headers: { 'x-api-key': this.apiKey } })
    const withdrawalId: string = res.data.id
    if (!withdrawalId) throw new Error('Tatum offchain withdrawal did not return an id')
    return withdrawalId
  }

  /**
   * Steps 2 + 3: Builds an unsigned blockchain transaction via Tatum's node
   * proxy, then signs it with the sender's key.
   */
  private async _buildAndSignTransaction({ chain, senderAddress, recipientAddress, amount, key }: {
    chain: string; senderAddress: string; recipientAddress: string; amount: string; key: KeyRef
  }): Promise<any> {
    if (chain === 'TRON') {
      // Build unsigned TRON transaction via Tatum's TronGrid node proxy
      const nodeUrl = `${this.TATUM_BASE_URL}/blockchain/node/TRON/wallet/createtransaction`
      const amountInSun = Math.round(parseFloat(amount) * 1_000_000) // TRX → SUN
      const buildRes = await axios.post(
        nodeUrl,
        { owner_address: senderAddress, to_address: recipientAddress, amount: amountInSun, visible: true },
        { headers: { 'x-api-key': this.apiKey } }
      )
      const unsignedTx = buildRes.data
      if (!unsignedTx.txID) throw new Error('TRON node did not return a txID for the unsigned transaction')

      const signatureHex = await signTron(key, unsignedTx, senderAddress)
      return { ...unsignedTx, signature: [signatureHex] }
    }

    if (chain === 'SOL') {
      // Solana has no Tatum-side tx builder (unlike TRON's createtransaction
      // node proxy), so we assemble and sign the transaction here.
      const connection = new Connection(`${this.TATUM_BASE_URL}/blockchain/node/SOL`, {
        httpHeaders: { 'x-api-key': this.apiKey! },
      })
      const { blockhash } = await connection.getLatestBlockhash()

      const fromPubkey = new PublicKey(senderAddress)
      const toPubkey = new PublicKey(recipientAddress)
      const lamports = BigInt(Math.round(parseFloat(amount) * 1_000_000_000)) // SOL → lamports

      // Tatum's broadcast deserializes into a VersionedTransaction, so build a v0 tx.
      const messageV0 = new TransactionMessage({
        payerKey: fromPubkey,
        recentBlockhash: blockhash,
        instructions: [SystemProgram.transfer({ fromPubkey, toPubkey, lamports })],
      }).compileToV0Message()
      const tx = new VersionedTransaction(messageV0)

      // Ed25519 signature over the serialized v0 message (not a hash).
      const signatureHex = await signSol(key, tx.message.serialize())
      tx.addSignature(fromPubkey, Buffer.from(signatureHex, 'hex'))

      // Raw signed tx (base64) — _broadcastTransaction submits it to the Solana
      // RPC node directly (Tatum's REST /broadcast parser rejects standard
      // web3.js serialization).
      return Buffer.from(tx.serialize()).toString('base64')
    }

    if (networkFor(chain) === 'TRON' && !isNativeCurrency(chain)) {
      const contractAddress = trc20ContractFor(chain)
      if (!contractAddress) throw new Error(`No TRC-20 contract configured for currency: ${chain}`)

      const amountInUnits = Math.round(parseFloat(amount) * 10 ** this.TRC20_DECIMALS)

      const estimatedEnergy = await estimateTrc20TransferEnergy(contractAddress, senderAddress, recipientAddress, amountInUnits)
      await ensureEnergy(senderAddress, estimatedEnergy)

      const unsignedTx = await buildTrc20Transfer(contractAddress, senderAddress, recipientAddress, amountInUnits, this.TRC20_FEE_LIMIT_SUN)

      const estimatedBandwidth = estimateTronBandwidth(unsignedTx)
      await ensureBandwidth(senderAddress, estimatedBandwidth)

      const signatureHex = await signTron(key, unsignedTx, senderAddress)
      return { ...unsignedTx, signature: [signatureHex] }
    }

    throw new Error(`Unsupported chain for withdrawal: ${chain}`)
  }

  /**
   * Step 4: Broadcasts the signed transaction to the blockchain via Tatum's
   * broadcast endpoint (designed for custom signing mechanisms).
   */
  private async _broadcastTransaction(chain: string, signedTxData: any): Promise<string> {
    if (chain === 'SOL') {
      // Submit straight to the Solana RPC node — Tatum's REST /broadcast parser
      // rejects standard web3.js serialization.
      const connection = new Connection(`${this.TATUM_BASE_URL}/blockchain/node/SOL`, {
        httpHeaders: { 'x-api-key': this.apiKey! },
      })
      const txId = await connection.sendRawTransaction(Buffer.from(signedTxData, 'base64'))
      console.log(`DEBUG (TatumProvider): SOL transaction broadcast via RPC. txId=${txId}`)
      return txId
    }

    // Keyed by network, not the raw currency — TRON's broadcast endpoint
    // doesn't distinguish a native transfer from a TRC-20 contract call, so
    // USDT_TRON/TUSDT_TRON must resolve to the same path as TRON.
    const broadcastPath = this.BROADCAST_PATHS[networkFor(chain) ?? chain]
    if (!broadcastPath) throw new Error(`No broadcast path configured for chain: ${chain}`)

    const url = `${this.TATUM_BASE_URL}/${broadcastPath}`
    const payload = { txData: typeof signedTxData === 'string' ? signedTxData : JSON.stringify(signedTxData) }
    console.log(`DEBUG (TatumProvider): POST ${url} — broadcasting signed transaction`)
    const res = await axios.post(url, payload, { headers: { 'x-api-key': this.apiKey } })

    const txId: string = res.data.txId ?? res.data.id ?? res.data.hash
    if (!txId) throw new Error(`Broadcast succeeded but no txId returned for chain: ${chain}`)
    return txId
  }

  /**
   * Step 5: Marks a pending offchain withdrawal as complete in Tatum's ledger.
   */
  private async _completeWithdrawal(withdrawalId: string, txId: string): Promise<void> {
    const url = `${this.TATUM_BASE_URL}/offchain/withdrawal/${withdrawalId}/${txId}`
    console.log(`DEBUG (TatumProvider): PUT ${url} — marking withdrawal complete`)
    await axios.put(url, {}, { headers: { 'x-api-key': this.apiKey } })
  }

  /**
   * Cancels a pending offchain withdrawal and credits the amount back to the
   * VA.
   */
  private async _cancelWithdrawal(withdrawalId: string): Promise<void> {
    const url = `${this.TATUM_BASE_URL}/offchain/withdrawal/${withdrawalId}?revert=true`
    console.log(`DEBUG (TatumProvider): DELETE ${url} — cancelling withdrawal`)
    try {
      await axios.delete(url, { headers: { 'x-api-key': this.apiKey } })
    } catch (err) {
      console.error(`CRITICAL (TatumProvider): failed to cancel withdrawal ${withdrawalId} — the VA stays debited, cancel it manually`, err)
    }
  }

  // True only when the node answered and refused the tx, i.e. it never reached the chain
  private _isBroadcastRejection(err: unknown): boolean {
    if (err instanceof SendTransactionError) return !/already been processed/i.test(err.message)
    return axios.isAxiosError(err) && !!err.response && err.response.status < 500
  }

  async createSubscription({ accountId, address, chain, webhookUrl }: CreateSubscriptionParams): Promise<CreateSubscriptionResponse> {
    const url = `${this.TATUM_BASE_URL}/subscription`
    const payload = {
      type: 'ADDRESS_TRANSACTION',
      attr: {
        address,
        chain: chain.toUpperCase(),
        url: webhookUrl,
      },
    }

    console.log(`DEBUG (TatumProvider): Creating ADDRESS_TRANSACTION subscription for accountId: ${accountId}, address: ${address}, chain: ${chain}`)

    try {
      const res = await axios.post(url, payload, { headers: { 'x-api-key': this.apiKey } })
      console.log(`DEBUG (TatumProvider): Subscription created. subscriptionId: ${res.data?.id}`)
      return { subscriptionId: res.data.id }
    } catch (error) {
      console.error(`ERROR (TatumProvider): Failed to create subscription for accountId: ${accountId}`, error)
      throw error
    }
  }

  async assignDepositAddress({ accountId, address }: AssignDepositAddressParams): Promise<AssignDepositAddressResponse> {
    const url = `${this.TATUM_BASE_URL}/offchain/account/${accountId}/address/${address}`

    console.log('DEBUG (TatumProvider): Calling assignDepositAddress.')
    console.log(`DEBUG (TatumProvider): PUT URL: ${url}`)

    try {
      // Tatum uses a PUT request to link an existing address to a VA
      const res = await axios.post(
        url,
        {}, // No body required for this Tatum endpoint
        {
          headers: { 'x-api-key': this.apiKey }
        }
      )

      // The response typically returns the address, confirming the link.
      console.log(`DEBUG (TatumProvider): Response status: ${res.status}. Assigned address: ${res.data?.address || address}`)
      return { address: res.data?.address || address }
    } catch (error) {
      console.error(`ERROR (TatumProvider): Failed to assign address ${address} to VA ${accountId}.`, error)
      throw new Error('Unable to assign external deposit address')
    }
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await axios.delete(`${this.TATUM_BASE_URL}/subscription/${subscriptionId}`, { headers: { 'x-api-key': this.apiKey } })
  }

  // Tatum also stops scanning the address for deposits
  async removeDepositAddress({ accountId, address }: AssignDepositAddressParams): Promise<void> {
    await axios.delete(`${this.TATUM_BASE_URL}/offchain/account/${accountId}/address/${address}`, { headers: { 'x-api-key': this.apiKey } })
  }

  // Only allowed while the account's balance is zero
  async deactivateVaAccount(accountId: string): Promise<void> {
    await axios.put(`${this.TATUM_BASE_URL}/ledger/account/${accountId}/deactivate`, undefined, { headers: { 'x-api-key': this.apiKey } })
  }

  // A virtual account's ledger balance — what Tatum lets a debit take from it
  async getVaBalance(accountId: string): Promise<{ accountBalance: number, availableBalance: number }> {
    const res = await axios.get(`${this.TATUM_BASE_URL}/ledger/account/${accountId}/balance`, { headers: { 'x-api-key': this.apiKey } })
    return { accountBalance: Number(res.data.accountBalance), availableBalance: Number(res.data.availableBalance) }
  }

  async getOnChainBalance({ chain, address }: OnChainBalanceParams): Promise<number> {
    switch (chain.toUpperCase()) {
      case 'TRON': return getTronBalance(address)
      case 'SOL': return getSolanaBalance(address)
      default: throw new Error(`getOnChainBalance: unsupported chain ${chain}`)
    }
  }
 
  async getAddressHistory({ chain, address }: GetAddressHistoryParams): Promise<OnChainTransaction[]> {
    switch (chain.toUpperCase()) {
      case 'TRON': return getTronHistory(address)
      case 'SOL': return getSolanaHistory(address)
      default: throw new Error(`getAddressHistory: unsupported chain ${chain}`)
    }
  }
}
