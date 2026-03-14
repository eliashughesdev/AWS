import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { transactWriteItems } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ledger/ProviderName'
import { createKmsKey } from '../../../utils/awsKms'
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
      const chain = event.body.chain
      const accountNumber = event.body.provider + crypto.randomUUID().replaceAll('-', '')

      // Create key in AWS KMS (needed for withdrawal signing via signatureId)
      console.log(`DEBUG: Creating AWS KMS key for chain: ${chain}, accountId: ${accountNumber}`)
      const kmsKeyId = await createKmsKey(chain, accountNumber)
      console.log(`DEBUG: AWS KMS key created. kmsKeyId: ${kmsKeyId}`)

      // Create virtual account in Tatum (needed for webhook subscriptions on incoming deposits)
      console.log(`DEBUG: Getting provider: ${event.body.provider}`)
      const vaProvider = ProviderRegistry.getProvider(event.body.provider as ProviderName)
      const userId = data.id

      console.log(`DEBUG: Calling vaProvider.createVaAccount for userId: ${userId}, currency: ${chain}, accountingCurrency: ${event.body.accounting_currency}`)
      const vaCreationPayload: CreateAccountParams = {
        userId,
        currency: chain,
        accountingCurrency: event.body.accounting_currency,
      }
      const { accountId } = await vaProvider.createVaAccount(vaCreationPayload)
      console.log(`DEBUG: Virtual Account created. accountId: ${accountId}`)

      // Let Tatum generate and link the deposit address
      console.log(`DEBUG: Calling generateDepositAddress for accountId: ${accountId}`)
      const { address: depositAddress } = await vaProvider.generateDepositAddress(accountId)
      console.log(`DEBUG: Deposit address generated: ${depositAddress}`)

      const newAccount: Record<string, any> = {
        id: userId,
        sk: `ACCOUNT#${accountNumber}`,
        currency: event.body.accounting_currency,
        provider: event.body.provider,
        accountNo: accountNumber,
        chain,
        kmsKeyId,
        depositAddress,
        vAccountId: accountId,
        created_at: Date.now(),
        fees: 'default',
        providerId: event.body.provider || 'default',
        status: 'active',
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
              kmsKeyId
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
