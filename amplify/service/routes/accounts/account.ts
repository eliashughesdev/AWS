import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { queryRecord, transactWriteItems } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { ProviderName } from '../../../providers/ledger/ProviderName'
import { networkFor } from '../../../utils/currencies'
import { provisionCustodialAccount } from '../../../utils/custodialAccount'
import { getEmailProvider } from '../../../utils/EmailProvider'
import { brandName } from '../../../utils/config'

export default class AccountHandler {
  async execute(event: any, context: Context) {
    console.log('DEBUG: AccountHandler execution started.')
    console.log('DEBUG: Event Body:', JSON.stringify(event.body))

    const userId   = event.requestContext?.authorizer?.userId ?? crypto.randomUUID()
    const chain    = event.body.chain
    const provider = event.body.provider as ProviderName
    const email    = event.body.email

    if (!networkFor(chain)) {
      console.error(`ERROR: Unsupported ledger currency: ${chain}`)
      return processError(100009)
    }

    const existingProfile = await queryRecord(
      'v2CustomerTable',
      'id = :id AND sk = :sk',
      { ':id': userId, ':sk': 'USERPROFILE' }
    )
    if (!existingProfile.success) return processError(100003)
    const profile = existingProfile.res?.[0]

    const userProfileRecord: Record<string, any> = {
      id: userId,
      sk: 'USERPROFILE',
      created_at: Date.now(),
      deleted_at: null,
      name: event.body.account_name,
      email: email ?? null,
      updated_at: Date.now(),
    }

    try {
      const account = await provisionCustodialAccount({
        userId,
        chain,
        provider,
        accountingCurrency: event.body.accounting_currency,
        merchantId: profile?.merchantId,
      })

      const result = await transactWriteItems({
        puts: [
          // Only a first account creates the profile; an existing one carries merchantId, KYC and tier
          ...(profile ? [] : [{ tableName: 'v2CustomerTable', item: userProfileRecord }]),
          { tableName: 'v2CustomerTable', item: account.accountRecord },
          { tableName: 'v1AccountBalanceTable', item: account.balanceRecord },
        ]
      })

      if (!result.success || !result.res) {
        console.log('Failed to perform atomic write for all required records')
        return processError(100003)
      }

      if (email) {
        try {
          await getEmailProvider().sendEmail(
            email,
            `Welcome to ${brandName()} — your account is ready`,
            `Your account has been created.\nAccount number: ${account.accountNo}\n\nWelcome aboard!`
          )
          console.log(`DEBUG: Welcome email sent to ${email}`)
        } catch (err) {
          console.error('Email send failed (non-fatal):', err)
        }
      }

      return response({
        statusCode: 200,
        headers: null,
        bodyObject: {
          success: true,
          res: { data: { id: userId, accountNo: account.accountNo, depositAddress: account.depositAddress } }
        }
      })
    } catch (err) {
      console.error('FATAL ERROR: Account creation error:', err)
      return processError(100002, 'Failed to create account')
    }
  }
}
