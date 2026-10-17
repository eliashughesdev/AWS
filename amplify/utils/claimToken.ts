import crypto from 'crypto'

import { queryRecord, updateItem } from './db'
import { claimTokenTtlSeconds } from './config'

const TOKEN_BYTES = 32

export interface ClaimToken {
  token: string
  tokenHash: string
  expiresAt: number
}

export const hashClaimToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex')

export const claimRecordId = (tokenHash: string) => `CLAIM#${tokenHash}`

/**
 * One-time token for the password-claim link. Only the hash is ever persisted:
 * v2CustomerTable is streamed and the stream handler logs whole records, so a
 * plaintext token written there would end up in CloudWatch.
 */
export const createClaimToken = (ttlSeconds = claimTokenTtlSeconds()): ClaimToken => {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url')
  return {
    token,
    tokenHash: hashClaimToken(token),
    expiresAt: Date.now() + ttlSeconds * 1_000,
  }
}

/**
 * Points at a user's current live claim. Lets resend find and invalidate a
 * still-unexpired prior token without a GSI — CLAIM rows are only keyed by
 * their own hash, so there'd otherwise be no way to look one up by userId.
 */
export const claimPointerKey = (userId: string) => ({ id: userId, sk: 'CLAIM_POINTER' })

export const claimPointerItem = (userId: string, tokenHash: string) => ({
  ...claimPointerKey(userId),
  tokenHash,
  updated_at: Date.now(),
})

/**
 * Marks a claim superseded, the same way claim.ts burns one on use — so a
 * stale copy of an old email reads as "already used" (100036) instead of a
 * confusing "not found". Not the caller's fault if this loses a race with
 * the payer claiming that exact token right now; either outcome leaves the
 * old token unusable, which is what matters.
 */
export const invalidateClaim = (tokenHash: string) =>
  updateItem({
    tableName: 'v2CustomerTable',
    key: { id: claimRecordId(tokenHash), sk: 'CLAIM' },
    updateExpression: 'SET #usedAt = :now',
    conditionExpression: 'attribute_not_exists(#usedAt) OR attribute_type(#usedAt, :nullType)',
    attributeNames: { '#usedAt': 'usedAt' },
    attributeValues: { ':now': Date.now(), ':nullType': 'NULL' },
  })

export type ClaimLookup =
  | { ok: true, record: Record<string, any> }
  | { ok: false, code: number }

/**
 * Loads a claim by its token and applies the three rejections both onboarding
 * endpoints share. 
 */
export const loadClaim = async (token: unknown): Promise<ClaimLookup> => {
  // Public endpoints: a malformed token should read as invalid.
  if (typeof token !== 'string' || !token) return { ok: false, code: 100034 }

  const res = await queryRecord(
    'v2CustomerTable',
    'id = :id AND sk = :sk',
    { ':id': claimRecordId(hashClaimToken(token)), ':sk': 'CLAIM' }
  )

  const record = res.res?.[0]
  if (!record) return { ok: false, code: 100034 }
  if (record.usedAt) return { ok: false, code: 100036 }
  if (record.expiresAt < Date.now()) return { ok: false, code: 100035 }
  return { ok: true, record }
}
