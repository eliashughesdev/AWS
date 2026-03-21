import axios from 'axios'
import { CreateAccountParams, CreateAccountResponse, AccountProvider, TransferFundsParams, TransferFundsResponse, CustomerAccount, AssignDepositAddressResponse, AssignDepositAddressParams, GenerateDepositAddressResponse, CreateSubscriptionParams, CreateSubscriptionResponse, WithdrawFundsParams, WithdrawFundsResponse } from '../provider'
import { signTronTransaction } from '../../../utils/awsKms'

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

  // Chain-specific Tatum broadcast endpoints.
  // Used as the final step in the custom signing flow — submit externally-signed tx.
  private readonly BROADCAST_PATHS: Record<string, string> = {
    TRON: 'tron/broadcast',
    SOL: 'solana/broadcast',
  }

  /**
   * Withdraws funds from a Tatum virtual account to an on-chain address.
   *
   * Uses the custom signing mechanism — avoids Tatum KMS polling entirely:
   *   1. Create offchain withdrawal record in Tatum ledger (debits the VA)
   *   2. Build an unsigned blockchain transaction via Tatum's node proxy
   *   3. Sign the transaction hash with AWS KMS (on-demand)
   *   4. Broadcast the signed transaction via Tatum's broadcast endpoint
   *   5. Mark the withdrawal complete in Tatum's ledger
   */
  async withdrawFunds({ accountId, address, amount, currency, kmsKeyId, senderAddress }: WithdrawFundsParams): Promise<WithdrawFundsResponse> {
    const chain = currency.toUpperCase()
    const decimals = this.DECIMAL_PLACES[chain] ?? 6
    const roundedAmount = parseFloat(amount).toFixed(decimals).replace(/\.?0+$/, '') || '0'

    console.log(`DEBUG (TatumProvider): withdrawFunds started. chain=${chain}, amount=${roundedAmount}, from=${senderAddress}, to=${address}`)

    // Step 1: Create withdrawal record — debits the VA
    const withdrawalId = await this._createOffchainWithdrawal({ accountId, address, amount: roundedAmount, currency: chain })
    console.log(`DEBUG (TatumProvider): Step 1 done — withdrawal record created. withdrawalId=${withdrawalId}`)

    // Steps 2 + 3: Build unsigned tx, sign with AWS KMS
    const signedTxData = await this._buildAndSignTransaction({ chain, senderAddress, recipientAddress: address, amount: roundedAmount, kmsKeyId })
    console.log(`DEBUG (TatumProvider): Steps 2+3 done — transaction built and signed.`)

    // Step 4: Broadcast the signed transaction via Tatum's broadcast endpoint
    const txId = await this._broadcastTransaction(chain, signedTxData)
    console.log(`DEBUG (TatumProvider): Step 4 done — transaction broadcast. txId=${txId}`)

    // Step 5: Mark the withdrawal complete in Tatum's ledger
    await this._completeWithdrawal(withdrawalId, txId)
    console.log(`DEBUG (TatumProvider): Step 5 done — withdrawal marked complete. withdrawalId=${withdrawalId}, txId=${txId}`)

    return { withdrawalId }
  }

  /**
   * Step 1: Creates a pending withdrawal record in Tatum's offchain ledger.
   * Debits the virtual account balance atomically.
   */
  private async _createOffchainWithdrawal({ accountId, address, amount, currency }: {
    accountId: string; address: string; amount: string; currency: string
  }): Promise<string> {
    const url = `${this.TATUM_BASE_URL}/offchain/withdrawal`
    const payload = { senderAccountId: accountId, address, amount, currency }
    console.log(`DEBUG (TatumProvider): POST ${url}`)
    const res = await axios.post(url, payload, { headers: { 'x-api-key': this.apiKey } })
    const withdrawalId: string = res.data.id
    if (!withdrawalId) throw new Error('Tatum offchain withdrawal did not return an id')
    return withdrawalId
  }

  /**
   * Steps 2 + 3: Builds an unsigned blockchain transaction via Tatum's node
   * proxy, then signs it with AWS KMS.
   */
  private async _buildAndSignTransaction({ chain, senderAddress, recipientAddress, amount, kmsKeyId }: {
    chain: string; senderAddress: string; recipientAddress: string; amount: string; kmsKeyId: string
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

      // Sign the txID (32-byte hash) with AWS KMS secp256k1
      const signatureHex = await signTronTransaction(kmsKeyId, unsignedTx.txID, senderAddress)
      return { ...unsignedTx, signature: [signatureHex] }
    }

    if (chain === 'SOL') {
      // TODO: build Solana transaction bytes with @solana/web3.js,
      // then call signSolTransaction(kmsKeyId, txBytes) from awsKms.ts
      throw new Error('SOL withdrawal signing not yet implemented')
    }

    throw new Error(`Unsupported chain for withdrawal: ${chain}`)
  }

  /**
   * Step 4: Broadcasts the signed transaction to the blockchain via Tatum's
   * broadcast endpoint (designed for custom signing mechanisms).
   */
  private async _broadcastTransaction(chain: string, signedTxData: any): Promise<string> {
    const broadcastPath = this.BROADCAST_PATHS[chain]
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
}
