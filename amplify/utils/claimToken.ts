import crypto from 'crypto'

import { queryRecord } from './db'

const TOKEN_BYTES = 32
const DEFAULT_TTL_DAYS = 7

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
export const createClaimToken = (ttlDays = DEFAULT_TTL_DAYS): ClaimToken => {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url')
  return {
    token,
    tokenHash: hashClaimToken(token),
    expiresAt: Date.now() + ttlDays * 86_400_000,
  }
}

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
