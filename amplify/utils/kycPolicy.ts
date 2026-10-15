import { queryRecord } from './db'
import { processError } from '../errors/http'
import { LEDGER_CURRENCY_IDS } from './currencies'

/**
 * Whether a money operation needs the caller's KYC approved: per merchant, currency and operation,
 * switched by staff (docs/public-api-plan.md D11). A switch nobody has set requires KYC.
 *
 * The POLICY#KYC row in v1MerchantTable keeps one top-level attribute per switch,
 * `<currency>#<operation>` (e.g. `USDT_TRON#withdraw: false`), so each is written alone: DynamoDB
 * cannot set a key inside a nested map that does not exist yet.
 */

export const KYC_OPERATIONS = ['withdraw', 'transfer', 'cardDeposit'] as const
export type KycOperation = (typeof KYC_OPERATIONS)[number]
export type KycSwitches = Record<KycOperation, boolean>

// How a refusal names the operation: "withdrawals in USDT_TRON need a verified identity"
const NOUN: Record<KycOperation, string> = { withdraw: 'withdrawals', transfer: 'transfers', cardDeposit: 'card deposits' }

export const KYC_POLICY_SK = 'POLICY#KYC'
export const switchAttribute = (currency: string, operation: KycOperation) => `${currency.toUpperCase()}#${operation}`

type PolicyRow = Record<string, unknown> | null

// The merchant's POLICY#KYC row; null when it has none. Throws when it cannot be read
export const readKycPolicy = async (merchantId: string | undefined): Promise<PolicyRow> => {
  if (!merchantId) return null
  const result = await queryRecord('v1MerchantTable', 'id = :id AND sk = :sk', { ':id': merchantId, ':sk': KYC_POLICY_SK })
  if (!result.success) throw new Error(`The KYC policy of ${merchantId} could not be read`)
  return result.res?.[0] ?? null
}

// Only an explicit false turns KYC off
export const kycRequiredBy = (row: PolicyRow, currency: string, operation: KycOperation) =>
  row?.[switchAttribute(currency, operation)] !== false

export const kycSwitchesFor = (row: PolicyRow, currency: string): KycSwitches =>
  Object.fromEntries(KYC_OPERATIONS.map(op => [op, kycRequiredBy(row, currency, op)])) as KycSwitches

// Every ledger currency's switches, unset ones answered as required
export const kycPolicyOf = (row: PolicyRow): Record<string, KycSwitches> =>
  Object.fromEntries(LEDGER_CURRENCY_IDS.map(currency => [currency, kycSwitchesFor(row, currency)]))

// Didit's status for a verified identity (routes/accounts/kyc-webhook-didit.ts stores it as sent)
export const isKycApproved = (profile: Record<string, any> | null | undefined) => profile?.kyc?.status === 'Approved'

/**
 * The check a money route makes once it has loaded the caller's own account, before anything is
 * debited, charged or queued. Undefined when the operation may go ahead; otherwise the response
 * to answer: 403 100059, or 500 when the policy or the profile could not be read (never let
 * through on a failed read).
 */
export const checkKyc = async ({ userId, merchantId, currency, operation }: {
  userId: string
  merchantId: string | undefined
  currency: string
  operation: KycOperation
}) => {
  let row: PolicyRow
  try {
    row = await readKycPolicy(merchantId)
  } catch (e: any) {
    console.error(`ERROR: ${e.message}`)
    return processError(100002, 'the identity check could not be made', 500)
  }
  if (!kycRequiredBy(row, currency, operation)) return undefined

  const profile = await queryRecord('v2CustomerTable', 'id = :id AND sk = :sk', { ':id': userId, ':sk': 'USERPROFILE' })
  if (!profile.success) {
    console.error('ERROR: The caller\'s profile could not be read for the KYC check')
    return processError(100002, 'the identity check could not be made', 500)
  }
  if (isKycApproved(profile.res?.[0])) return undefined

  console.log(`KYC_POLICY: ${operation} in ${currency} refused for an unverified user (merchant ${merchantId ?? '(none)'})`)
  return processError(100059, `${NOUN[operation]} in ${currency.toUpperCase()}`, 403)
}
