import type { Context } from 'aws-lambda'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { queryRecord, transactWriteItems } from '../../../utils/db'
import { addUserToGroup, adminCreateUser, EMAIL_RE, findUserByEmail } from '../../../utils/cognito'
import { ClaimToken, claimPointerItem, claimRecordId, createClaimToken } from '../../../utils/claimToken'
import { sendClaimInvite } from '../../../utils/claimInvite'
import { networkFor } from '../../../utils/currencies'
import { provisionCustodialAccount } from '../../../utils/custodialAccount'
import { getMerchant } from '../../../utils/merchant'
import { ProviderName } from '../../../providers/ledger/ProviderName'

type Event = {
  requestContext?: { authorizer?: { userId?: string } }
  body: {
    externalId: string
    firstName: string
    lastName: string
    email: string
    chain: string
    transaction: {
      id: string
      amount: number
      currency: string
      paidAt?: string
    }
  }
}

const mappingRecordId = (platform: string, externalId: string) => `EXT#${platform}#${externalId}`
const txnRecordId = (platform: string, providerTxId: string) => `TXN#${platform}#${providerTxId}`

/**
 * Intake for card payments collected on a merchant platform. For a first-time
 * payer it creates the Cognito identity, the profile and a one-time claim token
 * so the payer can choose their own password; for a known payer it only
 * acknowledges the transaction. No money is moved here.
 *
 * `platform` is the caller's API key id (X-Project), so an externalId only has
 * to be unique within the calling platform, not globally. 
 * */
export default class OnboardingHandler {
  async execute(event: Event, context: Context) {
    const platform = event.requestContext?.authorizer?.userId
    if (!platform) return processError(100031, 'platform')

    const merchantId = platform
    const merchant = await getMerchant(merchantId)
    if (!merchant.success) return processError(100003)
    if (merchant.res?.status !== 'active') return processError(100040)

    const { externalId, firstName, lastName, email, chain, transaction } = event.body

    if (!transaction.id || typeof transaction.amount !== 'number' || !transaction.currency) {
      return processError(100029, 'transaction.id, transaction.amount, transaction.currency')
    }
    if (!EMAIL_RE.test(email)) return processError(100031, 'email')
    // No server-side default on purpose: a fallback would quietly create the wrong
    // kind of account, and a KMS key plus a Tatum account cannot be taken back.
    if (!networkFor(chain)) return processError(100009)

    const now = Date.now()
    const mappingId = mappingRecordId(platform, externalId)
    const idempotencyId = txnRecordId(platform, transaction.id)

    console.log(`ONBOARDING: platform=${platform} externalId=${externalId} merchantId=${merchantId} tx=${transaction.id}`)

    const mapping = await queryRecord(
      'v2CustomerTable',
      'id = :id AND sk = :sk',
      { ':id': mappingId, ':sk': 'MAPPING' }
    )

    if (!mapping.success) return processError(100003)

    let userId: string
    let isNew = false
    let claim: ClaimToken | null = null

    const known = mapping.res?.[0]
    if (known) {
      userId = known.userId
    } else {
      const identity = await this.createIdentity(email)
      if ('error' in identity) return identity.error
      userId = identity.userId
      claim = identity.claim
      isNew = true
    }

    // A payer onboarded before this endpoint created accounts has none; provisioning
    // on their next transaction heals that without a migration.
    const account = (isNew || !(await this.hasAccount(userId)))
      ? await provisionCustodialAccount({
          userId,
          chain,
          provider: ProviderName.Tatum,
          accountingCurrency: transaction.currency,
          merchantId,
        })
      : null

    const idempotencyRecord = {
      id: idempotencyId,
      sk: 'IDEMPOTENCY',
      platform,
      merchantId,
      externalId,
      userId,
      providerTxId: transaction.id,
      amount: transaction.amount,
      currency: transaction.currency,
      paidAt: transaction.paidAt ?? null,
      // Phase 4 advances this once the funds are credited, converted and transferred.
      status: 'RECEIVED',
      receivedAt: now,
    }

    const puts: { tableName: string, item: Record<string, any>, conditionExpression?: string }[] = [
      { tableName: 'v2CustomerTable', item: idempotencyRecord, conditionExpression: 'attribute_not_exists(id)' },
    ]

    if (account) {
      puts.push(
        { tableName: 'v2CustomerTable', item: account.accountRecord },
        { tableName: 'v1AccountBalanceTable', item: account.balanceRecord },
      )
    }

    if (isNew && claim) {
      puts.push(
        {
          tableName: 'v2CustomerTable',
          item: {
            id: userId,
            sk: 'USERPROFILE',
            name: `${firstName} ${lastName}`.trim(),
            firstName,
            lastName,
            email,
            platform,
            externalId,
            merchantId,
            onboarding: 'EXTERNAL_MERCHANT',
            // Transactions and crypto are open without KYC; banking and cards
            // must check this before they are built.
            kyc: null,
            tier: 'unverified',
            created_at: now,
            updated_at: now,
            deleted_at: null,
          },
        },
        {
          tableName: 'v2CustomerTable',
          item: { id: mappingId, sk: 'MAPPING', userId, platform, externalId, merchantId, email, created_at: now },
          conditionExpression: 'attribute_not_exists(id)',
        },
        {
          tableName: 'v2CustomerTable',
          item: {
            id: claimRecordId(claim.tokenHash),
            sk: 'CLAIM',
            userId,
            email,
            expiresAt: claim.expiresAt,
            usedAt: null,
            created_at: now,
          },
        },
        { tableName: 'v2CustomerTable', item: claimPointerItem(userId, claim.tokenHash) },
      )
    }

    const written = await transactWriteItems({ puts })

    if (!written.success) {
      // A cancelled transaction means the txId or the mapping already exists —
      // a redelivery, not a failure. Report the first outcome instead of a 500.
      if (written.error?.name === 'TransactionCanceledException') {
        return await this.replay(idempotencyId)
      }
      console.error('ONBOARDING: failed to persist onboarding records', written.error)
      return processError(100003)
    }

    const emailSent = claim ? await sendClaimInvite(email, firstName, claim) : false

    console.log(`ONBOARDING: done userId=${userId} isNew=${isNew} emailSent=${emailSent} accountNo=${account?.accountNo ?? 'none'}`)

    return response({
      statusCode: isNew ? 201 : 200,
      headers: null,
      bodyObject: {
        success: true,
        res: {
          data: {
            userId,
            isNew,
            ...(account ? { accountNo: account.accountNo, depositAddress: account.depositAddress } : {}),
            ...(claim ? { claimToken: claim.token, claimExpiresAt: claim.expiresAt, emailSent } : {}),
          },
        },
      },
    })
  }

  /**
   * Resolves the Cognito identity for a payer we have no mapping for. An address
   * that already exists in Cognito but has no profile is an orphan left by an
   * earlier attempt that failed after AdminCreateUser — adopt it, otherwise the
   * payer could never be onboarded again.
   */
  private async createIdentity(email: string): Promise<{ error: any } | { userId: string, claim: ClaimToken }> {
    const existing = await findUserByEmail(email)

    if (existing?.sub) {
      const profile = await queryRecord(
        'v2CustomerTable',
        'id = :id AND sk = :sk',
        { ':id': existing.sub, ':sk': 'USERPROFILE' }
      )
      if (profile.res?.length) {
        console.error(`ONBOARDING: ${email} already belongs to user ${existing.sub}`)
        return { error: processError(100032) }
      }
      console.log(`ONBOARDING: adopting orphaned Cognito user ${existing.sub}`)
      return { userId: existing.sub, claim: createClaimToken() }
    }

    const { sub, username } = await adminCreateUser(email)
    await addUserToGroup(username, 'user')
    return { userId: sub, claim: createClaimToken() }
  }

  /** True when the payer already has at least one account record. */
  private async hasAccount(userId: string): Promise<boolean> {
    const existing = await queryRecord(
      'v2CustomerTable',
      'id = :id AND begins_with(sk, :prefix)',
      { ':id': userId, ':prefix': 'ACCOUNT#' }
    )
    return !!existing.res?.length
  }

  private async replay(idempotencyId: string) {
    const seen = await queryRecord(
      'v2CustomerTable',
      'id = :id AND sk = :sk',
      { ':id': idempotencyId, ':sk': 'IDEMPOTENCY' }
    )
    const record = seen.res?.[0]
    if (!record) return processError(100033)

    console.log(`ONBOARDING: redelivery of ${idempotencyId}, replaying first outcome`)
    return response({
      statusCode: 200,
      headers: null,
      bodyObject: {
        success: true,
        res: { data: { userId: record.userId, isNew: false, replayed: true } },
      },
    })
  }
}
