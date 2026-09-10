import crypto from 'crypto'

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
