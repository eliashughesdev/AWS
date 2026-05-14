import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { transactWriteItems } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ledger/ProviderName'
import { createBlockchainKey } from '../../../utils/awsKms'
import { CreateAccountParams } from '../../../providers/ledger/provider'
import { getEmailProvider } from '../../../utils/EmailProvider'
import { getSmsProvider } from '../../../utils/SmsProvider'

/**
 * Creates new account (internal)
 */
export default class AccountHandler {
  async execute(event: any, context: Context) {
    console.log('DEBUG: AccountHandler execution started.')
    console.log('DEBUG: Incoming Event:', JSON.stringify(event))
    console.log('DEBUG: Event Body:', JSON.stringify(event.body))

    const data: any = {
      id: event.requestContext?.authorizer?.userId ?? crypto.randomUUID(),
      sk: 'USERPROFILE',
      created_at: Date.now(),
      deleted_at: null,
      name: event.body.account_name,
      email: event.body.email ?? null,
      updated_at: Date.now(),
    }

    console.log('DEBUG: Internal Account Record (Initial):', JSON.stringify(data))

    try {
      const chain = event.body.chain
      const accountNumber = event.body.provider + crypto.randomUUID().replaceAll('-', '')

      // Create key in AWS KMS and derive deposit address
      console.log(`DEBUG: Creating AWS KMS key for chain: ${chain}, accountId: ${accountNumber}`)
      const { kmsKeyId, address: depositAddress } = await createBlockchainKey(chain, accountNumber)
      console.log(`DEBUG: AWS KMS key created. kmsKeyId: ${kmsKeyId}, depositAddress: ${depositAddress}`)

      // Create virtual account in Tatum (needed for webhook subscriptions on incoming deposits)
      console.log(`DEBUG: Getting provider: ${event.body.provider}`)
      const vaProvider = ProviderRegistry.getProvider(event.body.provider as ProviderName)
      const userId = data.id

      console.log(`DEBUG: Calling vaProvider.createVaAccount for userId: ${userId}, currency: ${chain}, accountingCurrency: ${event.body.accounting_currency}`)
      const vaCreationPayload: CreateAccountParams = {
        userId,
        currency: chain,
        accountingCurrency: event.body.accounting_currency,
        address: depositAddress,
      }
      const { accountId } = await vaProvider.createVaAccount(vaCreationPayload)
      console.log(`DEBUG: Virtual Account created. accountId: ${accountId}`)

      // Link the derived address to the Tatum virtual account
      console.log(`DEBUG: Assigning deposit address ${depositAddress} to accountId: ${accountId}`)
      const { address: assignedAddress } = await vaProvider.assignDepositAddress({ accountId, address: depositAddress })
      console.log(`DEBUG: Final Deposit address confirmed: ${assignedAddress}`)

      // Subscribe for real-time deposit notifications so the VA is credited immediately
      const webhookUrl = process.env.TATUM_WEBHOOK_URL!
      console.log(`DEBUG: Creating ADDRESS_TRANSACTION subscription. webhookUrl: ${webhookUrl}`)
      const { subscriptionId } = await vaProvider.createSubscription({ accountId, address: assignedAddress, chain, webhookUrl })
      console.log(`DEBUG: Subscription created. subscriptionId: ${subscriptionId}`)

      const newAccount: Record<string, any> = {
        id: userId,
        sk: `ACCOUNT#${accountNumber}`,
        currency: event.body.accounting_currency,
        provider: event.body.provider,
        accountNo: accountNumber,
        chain,
        kmsKeyId,
        depositAddress: assignedAddress,
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

      if (data.email) {
        try {
          const emailProvider = getEmailProvider()
          await emailProvider.sendEmail(
            data.email,
            'Welcome to Loudibly — your account is ready',
            `Your account has been created.\nAccount number: ${accountNumber}\n\nWelcome aboard!`
          )
          console.log(`DEBUG: Welcome email sent to ${data.email}`)
        } catch (err) {
          console.error('Email send failed (non-fatal):', err)
        }
      }

      if (event.body.phone) {
        try {
          const smsProvider = getSmsProvider()
          await smsProvider.sendSms(
            event.body.phone,
            `Your Loudibly account has been created.\nAccount number: ${accountNumber}\n\nWelcome aboard!`
          )
          console.log(`DEBUG: Welcome SMS sent to ${event.body.phone}`)
        } catch (err) {
          console.error('SMS send failed (non-fatal):', err)
        }
      }

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
              depositAddress
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
