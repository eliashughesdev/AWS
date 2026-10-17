import type { Context } from 'aws-lambda'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { scanItems } from '../../../utils/db'
import { KYC_POLICY_SK, kycPolicyOf } from '../../../utils/kycPolicy'

/**
 * Every merchant, newest first, with the currencies it has a master for and its KYC policy for
 * every ledger currency (unset switches answered as required, as the money routes treat them).
 * v1MerchantTable has no index by row kind, so this reads the whole table:
 * fine while only staff call it and the table is small.
 */
export default class ListMerchantsHandler {
  async execute(event: unknown, context: Context) {
    const rows = await scanItems('v1MerchantTable', 'sk = :profile OR begins_with(sk, :master) OR sk = :kyc', { ':profile': 'PROFILE', ':master': 'MASTER#', ':kyc': KYC_POLICY_SK })
    if (!rows.success || !rows.res) return processError(100002, undefined, 500)

    const masters = rows.res.filter(row => row.sk.startsWith('MASTER#'))
    const kycRows = rows.res.filter(row => row.sk === KYC_POLICY_SK)
    // Field by field: a master row also holds its Tatum account and derivation index
    const merchants = rows.res
      .filter(row => row.sk === 'PROFILE')
      .map(profile => ({
        merchantId: profile.id,
        name: profile.name,
        status: profile.status,
        accountingCurrency: profile.accountingCurrency ?? 'USD',
        createdAt: profile.createdAt ?? null,
        currencies: masters
          .filter(master => master.id === profile.id)
          .map(master => ({
            currency: master.sk.slice('MASTER#'.length),
            // `provisioning` until /merchants/masters/provision finishes it
            status: master.status,
            depositAddress: master.depositAddress ?? null,
          }))
          .sort((a, b) => a.currency.localeCompare(b.currency)),
        kycRequired: kycPolicyOf(kycRows.find(row => row.id === profile.id) ?? null),
      }))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))

    return response({ statusCode: 200, headers: null, bodyObject: { success: true, merchants } })
  }
}
