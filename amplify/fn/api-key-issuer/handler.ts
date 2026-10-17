import { createHash, randomBytes } from 'crypto'
import { DeleteParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { getRecord, putItem, updateItem } from '../../utils/db'
import { API_KEY_KMS_ALIAS, API_KEYS_TABLE, apiKeyParameterName } from '../../utils/apiKeyStore'
import { isPermission, permissions } from '../../service/permissions'

/**
 * apiKeyIssuerFn: the only code that writes or deletes an API key's hash (docs/public-api-plan.md
 * D2.1, D2.2). It runs under ApiKeyIssuerRole, which may put and delete parameters under
 * /loudibly/api-keys/, encrypt with the API keys' KMS key and write v1ApiKeysTable, and nothing
 * else. Only mainApiFn may invoke it (utils/apiKeyIssuer.ts); the routes decide who may create or
 * revoke which key, and this checks only that what it writes is well formed.
 *
 * A key is `lk_live_<16 hex>` with a secret `lks_<43 base64url>` (D1.3). The secret is returned by
 * `create` once and kept nowhere: SSM holds its SHA-256, hex, as a SecureString, and the row holds
 * neither. Nothing here logs the secret, the hash or the request.
 *
 * - create: hash first, then the row, so a row never names a missing hash. When the row cannot be
 *   written, the hash is deleted again (a hash with no row lets nothing in: the authorizer reads the
 *   row first).
 * - revoke: the row first, so the key stops working on the next call, then the hash. Revoking a
 *   revoked key answers ok and deletes its hash again if that failed before.
 */

const ssm = new SSMClient({})

const MAX_NAME = 64
const MAX_IPS = 20
const MAX_RATE = 1000

export type KeyOwnerType = 'user' | 'merchant'

export type CreateRequest = {
  op: 'create'
  ownerType: KeyOwnerType
  // The user's id, or the merchant's for a merchant key
  ownerId: string
  // The merchant the key's owner belongs to (the user's merchant for a user key)
  merchantId: string
  name: string
  permissions: string[]
  perSecond: number
  ipAllowlist?: string[]
  expiresAt?: string
  // Who asked: the owner's or a staff member's user id
  createdBy: string
}

export type RevokeRequest = {
  op: 'revoke'
  keyId: string
  revokedBy: string
  // When given, only a key of this owner is revoked; any other answers not_found
  ownerId?: string
  reason?: string
}

export type IssuerRequest = CreateRequest | RevokeRequest | { op?: unknown }

// What a key's row says about it, never its secret or hash
export type ApiKeyRow = {
  id: string
  ownerType: KeyOwnerType
  ownerId: string
  merchantId: string
  name: string
  permissions: string[]
  status: 'active' | 'revoked'
  rateLimit: { perSecond: number }
  ipAllowlist?: string[]
  expiresAt?: string
  createdAt: string
  createdBy: string
  lastUsedAt?: string
  revokedAt?: string
  revokedBy?: string
  revokeReason?: string
}

export type IssuerResponse =
  | { ok: true, keyId: string, secret: string, key: ApiKeyRow }
  | { ok: true, keyId: string, alreadyRevoked: boolean }
  | { ok: false, error: 'invalid', field: string }
  | { ok: false, error: 'not_found' }
  | { ok: false, error: 'failed' }
  | { ok: false, error: 'unknown operation' }

export const newKeyId = () => `lk_live_${randomBytes(8).toString('hex')}`
export const newSecret = () => `lks_${randomBytes(32).toString('base64url')}`
export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex')

const text = (value: unknown, max = 256): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max

// The first field of a create request that is not as the row needs it, or null
const invalidField = (r: CreateRequest): string | null => {
  if (r.ownerType !== 'user' && r.ownerType !== 'merchant') return 'ownerType'
  if (!text(r.ownerId)) return 'ownerId'
  if (!text(r.merchantId)) return 'merchantId'
  if (!text(r.name, MAX_NAME)) return 'name'
  if (!Array.isArray(r.permissions) || r.permissions.length === 0) return 'permissions'
  // A permission held by the other kind of owner would never be usable by this key
  if (!r.permissions.every(p => isPermission(p) && permissions[p].owner === r.ownerType)) return 'permissions'
  if (!Number.isInteger(r.perSecond) || r.perSecond < 1 || r.perSecond > MAX_RATE) return 'perSecond'
  if (r.ipAllowlist !== undefined && !(Array.isArray(r.ipAllowlist) && r.ipAllowlist.length <= MAX_IPS && r.ipAllowlist.every(ip => text(ip, 45)))) return 'ipAllowlist'
  if (r.expiresAt !== undefined && !(text(r.expiresAt, 40) && !Number.isNaN(Date.parse(r.expiresAt)) && Date.parse(r.expiresAt) > Date.now())) return 'expiresAt'
  if (!text(r.createdBy)) return 'createdBy'
  return null
}

const deleteHash = async (keyId: string) => {
  try {
    await ssm.send(new DeleteParameterCommand({ Name: apiKeyParameterName(keyId) }))
    return true
  } catch (err: any) {
    if (err?.name === 'ParameterNotFound') return true
    console.error(`ERROR: API key ${keyId}: its hash could not be deleted (${err?.name ?? 'unknown error'})`)
    return false
  }
}

async function create(r: CreateRequest): Promise<IssuerResponse> {
  const field = invalidField(r)
  if (field) return { ok: false, error: 'invalid', field }

  const secret = newSecret()
  const hash = hashSecret(secret)

  // A new id each time one is taken (16 hex digits: practically never)
  let keyId = ''
  for (let attempt = 0; attempt < 3 && !keyId; attempt++) {
    const candidate = newKeyId()
    try {
      await ssm.send(new PutParameterCommand({
        Name: apiKeyParameterName(candidate),
        Value: hash,
        Type: 'SecureString',
        KeyId: API_KEY_KMS_ALIAS,
        Tier: 'Standard',
        Overwrite: false,
      }))
      keyId = candidate
    } catch (err: any) {
      if (err?.name === 'ParameterAlreadyExists') continue
      console.error(`ERROR: An API key's hash could not be written (${err?.name ?? 'unknown error'})`)
      return { ok: false, error: 'failed' }
    }
  }
  if (!keyId) {
    console.error('ERROR: No free API key id after 3 attempts')
    return { ok: false, error: 'failed' }
  }

  const row: ApiKeyRow = {
    id: keyId,
    ownerType: r.ownerType,
    ownerId: r.ownerId,
    merchantId: r.merchantId,
    name: r.name.trim(),
    permissions: [...new Set(r.permissions)].sort(),
    status: 'active',
    rateLimit: { perSecond: r.perSecond },
    ...(r.ipAllowlist?.length ? { ipAllowlist: r.ipAllowlist } : {}),
    ...(r.expiresAt ? { expiresAt: new Date(r.expiresAt).toISOString() } : {}),
    createdAt: new Date().toISOString(),
    createdBy: r.createdBy,
  }
  const written = await putItem(API_KEYS_TABLE, row, 'attribute_not_exists(id)')
  if (!written.success) {
    console.error(`ERROR: API key ${keyId}: its row could not be written (${written.error?.name ?? 'unknown error'}); deleting its hash`)
    await deleteHash(keyId)
    return { ok: false, error: 'failed' }
  }

  console.log(`API_KEY_ISSUER: created ${keyId} for ${r.ownerType} ${r.ownerId} by ${r.createdBy}`)
  return { ok: true, keyId, secret, key: row }
}

async function revoke(r: RevokeRequest): Promise<IssuerResponse> {
  if (!text(r.keyId, 64)) return { ok: false, error: 'invalid', field: 'keyId' }
  if (!text(r.revokedBy)) return { ok: false, error: 'invalid', field: 'revokedBy' }
  if (r.ownerId !== undefined && !text(r.ownerId)) return { ok: false, error: 'invalid', field: 'ownerId' }
  if (r.reason !== undefined && !(typeof r.reason === 'string' && r.reason.length <= 500)) return { ok: false, error: 'invalid', field: 'reason' }

  const owned = r.ownerId !== undefined ? ' AND ownerId = :owner' : ''
  const marked = await updateItem({
    tableName: API_KEYS_TABLE,
    key: { id: r.keyId },
    updateExpression: `SET #status = :revoked, revokedAt = :now, revokedBy = :by${r.reason ? ', revokeReason = :reason' : ''}`,
    conditionExpression: `attribute_exists(id) AND #status <> :revoked${owned}`,
    attributeNames: { '#status': 'status' },
    attributeValues: {
      ':revoked': 'revoked',
      ':now': new Date().toISOString(),
      ':by': r.revokedBy,
      ...(r.reason ? { ':reason': r.reason } : {}),
      ...(r.ownerId !== undefined ? { ':owner': r.ownerId } : {}),
    },
  })

  let alreadyRevoked = false
  if (!marked.success) {
    if (marked.error?.name !== 'ConditionalCheckFailedException') {
      console.error(`ERROR: API key ${r.keyId} could not be revoked (${marked.error?.name ?? 'unknown error'})`)
      return { ok: false, error: 'failed' }
    }
    // Missing, someone else's, or revoked already: only the last is ok
    const existing = await getRecord(API_KEYS_TABLE, r.keyId)
    if (!existing.success) return { ok: false, error: 'failed' }
    const row = existing.res
    if (!row || (r.ownerId !== undefined && row.ownerId !== r.ownerId)) return { ok: false, error: 'not_found' }
    alreadyRevoked = true
  }

  // The key no longer works whatever happens here: the authorizer reads the row first
  await deleteHash(r.keyId)
  console.log(`API_KEY_ISSUER: revoked ${r.keyId} by ${r.revokedBy}${alreadyRevoked ? ' (already revoked)' : ''}`)
  return { ok: true, keyId: r.keyId, alreadyRevoked }
}

export const handler = async (event: IssuerRequest): Promise<IssuerResponse> => {
  switch (event?.op) {
    case 'create': return create(event as CreateRequest)
    case 'revoke': return revoke(event as RevokeRequest)
    default:
      console.log(`API_KEY_ISSUER: refused operation ${JSON.stringify(typeof event?.op === 'string' ? event.op : null)}`)
      return { ok: false, error: 'unknown operation' }
  }
}
