import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { transactWriteItems } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ledger/ProviderName'
import { TatumKmsClient } from '../../../providers/ledger/tatum/TatumKmsClient'
import { CreateAccountParams } from '../../../providers/ledger/provider'

/**
 * Creates new account (internal)
 */
export default class AccountHandler {
  async execute(event: any, context: Context) {
    console.log('DEBUG: AccountHandler execution started.')
    console.log('DEBUG: Incoming Event:', JSON.stringify(event))
    console.log('DEBUG: Event Body:', JSON.stringify(event.body))

    const data: any = {
      id: crypto.randomUUID(),
      sk: 'USERPROFILE',
      created_at: Date.now(),
      deleted_at: null,
      name: event.body.account_name,
      updated_at: Date.now(),
    }

    console.log('DEBUG: Internal Account Record (Initial):', JSON.stringify(data))

    try {
      // create wallent in kms
      console.log('DEBUG: Initializing TatumKmsClient...')
      const kmsClient = new TatumKmsClient()
      const chain = event.body.chain

      console.log(`DEBUG: Calling kmsClient.generateWallet for chain: ${chain}`)
      const { signatureId, xpub, address: kmsAddress } = await kmsClient.generateWallet(chain)

      const identifier = xpub || kmsAddress
      console.log(`DEBUG: Wallet generated. signatureId: ${signatureId}, Identifier: ${identifier}`)

      // create virtual account
      console.log(`DEBUG: Getting provider: ${event.body.provider}`)
      const vaProvider = ProviderRegistry.getProvider(event.body.provider as ProviderName)
      const userId = data.id

      console.log(`DEBUG: Calling vaProvider.createVaAccount for userId: ${userId}, currency: ${chain}, xpub: ${xpub}, address: ${kmsAddress} accountingCurrency: ${event.body.accounting_currency}`)

      const vaCreationPayload: CreateAccountParams = {
        userId,
        currency: chain,
        accountingCurrency: event.body.accounting_currency,
        xpub,
        address: kmsAddress
      }
      const { accountId } = await vaProvider.createVaAccount(vaCreationPayload)
      console.log(`DEBUG: Virtual Account created. accountId: ${accountId}`)

      // 3. Generate or Assign Deposit Address
      let depositAddress: string = ''

      if (kmsAddress) {
        // If KMS returned a direct address
        console.log(`DEBUG: KMS returned direct address. Calling vaProvider.assignDepositAddress for accountId: ${accountId}`)
        const { address: assignedAddress } = await vaProvider.assignDepositAddress({ accountId, address: kmsAddress })
        depositAddress = assignedAddress
      } else if (xpub) {
        // If KMS returned an xpub (HD chain), generate the next address.
        console.log(`DEBUG: KMS returned xpub. Calling vaProvider.generateDepositAddress for accountId: ${accountId}`)
        const { address } = (await vaProvider.generateDepositAddress(accountId))
        depositAddress = address
      } else {
        throw new Error("one of 'xpub' or 'address' is needed to generate deposit address")
      }

      console.log(`DEBUG: Final Deposit address confirmed: ${depositAddress}`)

      const accountNumber = event.body.provider + crypto.randomUUID().replaceAll('-', '')
      const newAccount: Record<string, any> = {
        id: userId,
        sk: `ACCOUNT#${accountNumber}`,
        currency: event.body.accounting_currency,
        provider: event.body.provider,
        accountNo: accountNumber,
        chain,
        signatureId,
        depositAddress,
        vAccountId: accountId,
        created_at: Date.now(),
        fees: 'default',
        providerId: event.body.provider || 'default',
        status: 'active',
      }

      if (xpub) {
        newAccount.xpub = xpub
      }

      const newAccountBalance: Record<string, any> = {
        id: accountId,
        availableBalance: 0.0,
        balance: 0.0,
        created_at: Date.now(),
        updated_at: Date.now(),
      }

      console.log('DEBUG: Account Balance Record (Initial):', JSON.stringify(newAccountBalance))

      const itemsToTransact = [
        { tableName: 'v2CustomerTable', item: data },
        { tableName: 'v2CustomerTable', item: newAccount },
        { tableName: 'v1AccountBalanceTable', item: newAccountBalance },
      ]

      console.log('DEBUG: Attempting to save all records transactionally...')

      const transactionResult = await transactWriteItems({ puts: itemsToTransact })

      if (!transactionResult.success || !transactionResult.res) {
        console.log('Failed to perform atomic write for all required records')
        return processError(100003)
      }
      console.log('DEBUG: atomic transaction save attempt result:', JSON.stringify(transactionResult))

      console.log('DEBUG: Account creation flow successful. Returning 200 response.')
      return response({
        statusCode: 200,
        headers: null,
        bodyObject: {
          success: true,
          res: {
            data: {
              id: data.id,
              accountNo: accountNumber,
              depositAddress,
              signatureId
            }
          }
        }
      })
    } catch (err) {
      console.error('FATAL ERROR: Wallet/VA creation error:', err)
      return processError(100002, 'Failed to create virtual account')
    }
  }
}
