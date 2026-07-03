import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { transactWriteItems } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ledger/ProviderName'
import { createBlockchainKey } from '../../../utils/awsKms'
import { CreateAccountParams } from '../../../providers/ledger/provider'
import { getEmailProvider } from '../../../utils/EmailProvider'
import { sendToQueue } from '../../../utils/sqs'
import { Result } from 'aws-cdk-lib/aws-stepfunctions'
import { Address } from '@tatumio/tatum'

export default class AccountHandler {
  async execute(event: any, context: Context) {
    console.log('DEBUG: AccountHandler execution started.')
    console.log('DEBUG: Incoming Event:', JSON.stringify(event))
    console.log('DEBUG: Event Body:', JSON.stringify(event.body))

    const userId      = event.requestContext?.authorizer?.userId ?? crypto.randomUUID()
    const walletType  = event.body.walletType ?? 'custodial'
    const chain       = event.body.chain
    const provider    = event.body.provider as ProviderName
    const accountNumber = event.body.provider + crypto.randomUUID().replaceAll('-', '')
    const webhookUrl  = process.env.TATUM_WEBHOOK_URL!

    const userProfileRecord: Record<string, any> = {
      id: userId,
      sk: 'USERPROFILE',
      created_at: Date.now(),
      deleted_at: null,
      name: event.body.account_name,
      email: event.body.email ?? null,
      updated_at: Date.now(),
    }

    console.log('DEBUG: Internal Account Record (Initial):', JSON.stringify(userProfileRecord))

    try {
      if (walletType === 'non-custodial') {
        return await this.createNonCustodialAccount({
          userId, chain, provider, accountNumber, webhookUrl,
          publicAddress: event.body.publicAddress,
          accountingCurrency: event.body.accounting_currency,
          userProfileRecord,
          isImport: event.body.external === true,
        })
      }

      return await this.createCustodialAccount({
        userId, chain, provider, accountNumber, webhookUrl,
        accountingCurrency: event.body.accounting_currency,
        userProfileRecord,
        email: event.body.email,
      })
    } catch (err) {
      console.error('FATAL ERROR: Account creation error:', err)
      return processError(100002, 'Failed to create account')
    }
  }

  private async createNonCustodialAccount({
    userId, chain, provider, accountNumber, webhookUrl, publicAddress, accountingCurrency, userProfileRecord, isImport,
  }: {
    userId: string; chain: string; provider: ProviderName; accountNumber: string
    webhookUrl: string; publicAddress: string; accountingCurrency: string
    userProfileRecord: Record<string, any>
    isImport: boolean
  }) {
    console.log(`DEBUG: Non-custodial account creation. chain=${chain}, address=${publicAddress}`)

    const vaProvider = ProviderRegistry.getProvider(provider)

    // ADDRESS_TRANSACTION subscriptions work without a VA — subscribe directly to the user's address.
    const { subscriptionId } = await vaProvider.createSubscription({
      accountId: accountNumber,
      address: publicAddress,
      chain,
      webhookUrl,
    })
    console.log(`DEBUG: Non-custodial subscription created. subscriptionId=${subscriptionId}`)

    const accountRecord: Record<string, any> = {
      id: userId,
      sk: `ACCOUNT#${accountNumber}`,
      walletType: 'non-custodial',
      currency: accountingCurrency,
      provider,
      accountNo: accountNumber,
      chain,
      depositAddress: publicAddress,
      created_at: Date.now(),
      fees: 'default',
      status: isImport ? 'importing' :'active',
    }

    // Balance record keyed by accountNo (no vAccountId for non-custodial).
    const balanceRecord: Record<string, any> = {
      id: accountNumber,
      availableBalance: 0.0,
      balance: 0.0,
      created_at: Date.now(),
      updated_at: Date.now(),
    }

    const result = await transactWriteItems({
      puts: [
        { tableName: 'v2CustomerTable', item: userProfileRecord },
        { tableName: 'v2CustomerTable', item: accountRecord },
        { tableName: 'v1AccountBalanceTable', item: balanceRecord },
      ]
    })

    if (!result.success || !result.res) {
      console.log('Failed to perform atomic write for non-custodial account records')
      return processError(100003)
    }

    if (isImport) {
      await this.enqueueBackFill({ userId, accountNo: accountNumber, address: publicAddress, chain })
    }

    console.log('DEBUG: Non-custodial account creation successful.')
    return response({
      statusCode: 200,
      headers: null,
      bodyObject: {
        success: true,
        res: { data: { id: userId, accountNo: accountNumber, depositAddress: publicAddress } }
      }
    })
  }

  private async enqueueBackFill({userId, accountNo, address, chain}:{
    userId: string; accountNo: string; address:string; chain: string
  }) {
    const queueUrl = process.env.ACCOUNT_BACKFILL_QUEUE_URL
    if (!queueUrl) {
      console.error('BACKFILL: ACCOUNT_BACKFILL_QUEUE_URL not set; skipping enqueue')
      return
    }
    const result = await sendToQueue(queueUrl, {
      queue:'v1-account-backfill-queue',
      userId,
      accountNo,
      address,
      chain,
    })
    result.success ? console.log(`BACKFILL: enueued ${accountNo} (${chain} ${address})`) : console.error('BACKFILL: enqueue failed', result.e)
  }

  private async createCustodialAccount({
    userId, chain, provider, accountNumber, webhookUrl, accountingCurrency, userProfileRecord, email,
  }: {
    userId: string; chain: string; provider: ProviderName; accountNumber: string
    webhookUrl: string; accountingCurrency: string; userProfileRecord: Record<string, any>
    email?: string
  }) {
    // Create key in AWS KMS and derive deposit address
    console.log(`DEBUG: Creating AWS KMS key for chain: ${chain}, accountId: ${accountNumber}`)
    const { kmsKeyId, address: depositAddress } = await createBlockchainKey(chain as 'TRON' | 'SOL', accountNumber)
    console.log(`DEBUG: AWS KMS key created. kmsKeyId: ${kmsKeyId}, depositAddress: ${depositAddress}`)

    const vaProvider = ProviderRegistry.getProvider(provider)

    console.log(`DEBUG: Calling vaProvider.createVaAccount for userId: ${userId}, currency: ${chain}, accountingCurrency: ${accountingCurrency}`)
    const vaCreationPayload: CreateAccountParams = {
      userId,
      currency: chain,
      accountingCurrency,
      address: depositAddress,
    }
    const { accountId } = await vaProvider.createVaAccount(vaCreationPayload)
    console.log(`DEBUG: Virtual Account created. accountId: ${accountId}`)

    console.log(`DEBUG: Assigning deposit address ${depositAddress} to accountId: ${accountId}`)
    const { address: assignedAddress } = await vaProvider.assignDepositAddress({ accountId, address: depositAddress })
    console.log(`DEBUG: Final Deposit address confirmed: ${assignedAddress}`)

    console.log(`DEBUG: Creating ADDRESS_TRANSACTION subscription. webhookUrl: ${webhookUrl}`)
    const { subscriptionId } = await vaProvider.createSubscription({ accountId, address: assignedAddress, chain, webhookUrl })
    console.log(`DEBUG: Subscription created. subscriptionId: ${subscriptionId}`)

    const accountRecord: Record<string, any> = {
      id: userId,
      sk: `ACCOUNT#${accountNumber}`,
      currency: accountingCurrency,
      provider,
      accountNo: accountNumber,
      chain,
      kmsKeyId,
      depositAddress: assignedAddress,
      vAccountId: accountId,
      created_at: Date.now(),
      fees: 'default',
      providerId: provider || 'default',
      status: 'active',
    }

    const balanceRecord: Record<string, any> = {
      id: accountId,
      availableBalance: 0.0,
      balance: 0.0,
      created_at: Date.now(),
      updated_at: Date.now(),
    }

    console.log('DEBUG: Account Balance Record (Initial):', JSON.stringify(balanceRecord))
    console.log('DEBUG: Attempting to save all records transactionally...')

    const result = await transactWriteItems({
      puts: [
        { tableName: 'v2CustomerTable', item: userProfileRecord },
        { tableName: 'v2CustomerTable', item: accountRecord },
        { tableName: 'v1AccountBalanceTable', item: balanceRecord },
      ]
    })

    if (!result.success || !result.res) {
      console.log('Failed to perform atomic write for all required records')
      return processError(100003)
    }

    console.log('DEBUG: atomic transaction save attempt result:', JSON.stringify(result))

    if (email) {
      try {
        const emailProvider = getEmailProvider()
        await emailProvider.sendEmail(
          email,
          'Welcome to Loudibly — your account is ready',
          `Your account has been created.\nAccount number: ${accountNumber}\n\nWelcome aboard!`
        )
        console.log(`DEBUG: Welcome email sent to ${email}`)
      } catch (err) {
        console.error('Email send failed (non-fatal):', err)
      }
    }

    console.log('DEBUG: Custodial account creation successful. Returning 200 response.')
    return response({
      statusCode: 200,
      headers: null,
      bodyObject: {
        success: true,
        res: { data: { id: userId, accountNo: accountNumber, depositAddress } }
      }
    })
  }
}
