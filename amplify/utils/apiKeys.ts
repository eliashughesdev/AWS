import { processError } from '../errors/http'
import { isPermission, permissions as catalogue, type PermissionOwner } from '../service/permissions'
import { API_KEYS_BY_OWNER, API_KEYS_TABLE, defaultRateLimit } from './apiKeyStore'
import { issueApiKey, revokeApiKey } from './apiKeyIssuer'
import { response } from './http'
import { brandName } from './config'
import { getUserEmail } from './cognito'
import { getRecord, queryItemFromIndex } from './db'
import { getEmailProvider } from './EmailProvider'
import { apiKeyChangedEmail } from './emailTemplates'
import { parseAllowlist } from './ipAddress'
import { listMembers } from './merchant'
import type { ApiKeyRow } from '../fn/api-key-issuer/handler'

/**
 * What the key-management routes share (docs/public-api-plan.md D2.6): users manage their own keys
 * under /accounts/api-keys/*, staff a merchant's under /merchants/api-keys/*. Every one of them
 * takes a signed-in session only, never a key or HMAC signature.
 */

export const MAX_ACTIVE_KEYS = 10

type Authorizer = { userId?: string, authType?: string } | undefined

/** The signed-in user's id, or 403 100057 for any other credential. */
export const signedInOnly = (authorizer: Authorizer) =>
  authorizer?.authType === 'jwt' && authorizer.userId
    ? { userId: authorizer.userId }
    : { error: processError(100057, undefined, 403) }

/** What a key's owner and staff see of it. The row holds no secret or hash; this keeps it that way. */
export const keyView = (row: Record<string, any>) => ({
  keyId: row.id,
  name: row.name,
  ownerType: row.ownerType,
  ownerId: row.ownerId,
  merchantId: row.merchantId,
  permissions: [...(row.permissions ?? [])],
  status: row.status,
  rateLimit: row.rateLimit,
  ipAllowlist: row.ipAllowlist ?? [],
  expiresAt: row.expiresAt ?? null,
  createdAt: row.createdAt,
  createdBy: row.createdBy,
  lastUsedAt: row.lastUsedAt ?? null,
  revokedAt: row.revokedAt ?? null,
  revokedBy: row.revokedBy ?? null,
  revokeReason: row.revokeReason ?? null,
})

/** An owner's keys, oldest first; null when they could not be read. */
export const keysOf = async (ownerId: string): Promise<Record<string, any>[] | null> => {
  const result = await queryItemFromIndex({
    tableName: API_KEYS_TABLE,
    indexName: API_KEYS_BY_OWNER,
    keyConditionExpression: 'ownerId = :owner',
    attributeNames: undefined,
    attributeValues: { ':owner': ownerId },
  })
  return result.success ? result.res ?? [] : null
}

/** A key counts towards the limit while it can be used: active and not expired. */
export const isUsable = (row: Record<string, any>, now = Date.now()) =>
  row.status === 'active' && !(row.expiresAt && Date.parse(row.expiresAt) <= now)

/** Permissions as sent: 100058 for one this kind of owner cannot hold; duplicates dropped. */
export const checkPermissions = (names: string[], owner: PermissionOwner) => {
  const unknown = names.find(name => !isPermission(name) || catalogue[name].owner !== owner)
  if (unknown !== undefined) return { error: processError(100058, unknown) }
  return { permissions: [...new Set(names)] }
}

/** An IP allowlist as sent: 100062 for a bad entry or more than 20. */
export const checkAllowlist = (entries: unknown[] | undefined) => {
  if (entries === undefined) return { ips: undefined }
  const parsed = parseAllowlist(entries)
  return parsed.ok ? { ips: parsed.ips } : { error: processError(100062, parsed.bad) }
}

/** The catalogue a kind of owner may grant: name, description and group. */
export const permissionsFor = (owner: PermissionOwner) =>
  Object.entries(catalogue)
    .filter(([, info]) => info.owner === owner)
    .map(([name, info]) => ({ name, description: info.description, group: info.group }))

// Who hears about a key: a user's own email, or a merchant's active team
const recipientsOf = async (row: Pick<ApiKeyRow, 'ownerType' | 'ownerId'>): Promise<string[]> => {
  if (row.ownerType === 'user') {
    const email = await getUserEmail(row.ownerId)
    return email ? [email] : []
  }
  const members = await listMembers(row.ownerId)
  return members.res.filter(member => member.status === 'active' && member.email).map(member => member.email)
}

/**
 * Emails a key's owner that it was created or revoked. Never fails the request: the key exists or
 * is revoked whatever happens here, so a failure is logged and the route answers as it would.
 */
export const notifyKeyOwner = async (
  row: Pick<ApiKeyRow, 'id' | 'name' | 'ownerType' | 'ownerId'>,
  change: 'created' | 'revoked',
  by: { staff: boolean, reason?: string }
) => {
  try {
    const recipients = await recipientsOf(row)
    if (recipients.length === 0) {
      console.log(`API_KEY: nobody to tell that ${row.id} was ${change}`)
      return
    }
    const message = apiKeyChangedEmail({
      brand: brandName(),
      change,
      keyName: row.name,
      keyId: row.id,
      byStaff: by.staff,
      reason: by.reason,
      at: new Date().toISOString(),
    })
    const provider = getEmailProvider()
    for (const to of recipients) await provider.sendEmail(to, message.subject, message.text, message.html)
    console.log(`API_KEY: told ${recipients.length} recipient(s) that ${row.id} was ${change}`)
  } catch (err: any) {
    console.error(`ERROR: Could not tell the owner that ${row.id} was ${change} (${err?.name ?? 'unknown error'})`)
  }
}

/**
 * Creates a key for a user or a merchant once the route has decided who may: checks the
 * permissions and IP allowlist, counts the owner's usable keys, asks the issuer, tells the owner.
 * Answers the key and its secret, which nothing keeps: the caller shows it once.
 *
 * When the issuer cannot be reached the key may or may not exist; the answer says so (500 100002)
 * and the client must check the list rather than send it again.
 */
export const createKey = async (request: {
  ownerType: PermissionOwner
  ownerId: string
  merchantId: string
  name: string
  permissions: string[]
  expiresAt?: string
  ipAllowlist?: unknown[]
  createdBy: string
}) => {
  const granted = checkPermissions(request.permissions, request.ownerType)
  if (granted.error) return granted.error
  const allowlist = checkAllowlist(request.ipAllowlist)
  if (allowlist.error) return allowlist.error

  const keys = await keysOf(request.ownerId)
  if (!keys) return processError(100003)
  if (keys.filter(row => isUsable(row)).length >= MAX_ACTIVE_KEYS) return processError(100054, MAX_ACTIVE_KEYS)

  let issued
  try {
    issued = await issueApiKey({
      ownerType: request.ownerType,
      ownerId: request.ownerId,
      merchantId: request.merchantId,
      name: request.name.trim(),
      permissions: granted.permissions!,
      perSecond: defaultRateLimit(),
      ...(allowlist.ips?.length ? { ipAllowlist: allowlist.ips } : {}),
      ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
      createdBy: request.createdBy,
    })
  } catch (err: any) {
    console.error(`ERROR: The API key issuer could not be reached (${err?.message})`)
    return processError(100002, 'the key may or may not have been created; check the list before trying again', 500)
  }
  if (!issued.ok) {
    if (issued.error === 'invalid') return processError(100031, (issued as { field: string }).field)
    return processError(100002, 'the key was not created', 500)
  }
  const { key, secret } = issued as { key: ApiKeyRow, secret: string }

  await notifyKeyOwner(key, 'created', { staff: request.ownerType === 'merchant' })
  return response({ statusCode: 200, headers: null, bodyObject: { success: true, key: keyView(key), secret } })
}

/** Revokes a key (the owner's own when ownerId is given) and tells its owner. */
export const revokeKey = async (request: { keyId: string, revokedBy: string, ownerId?: string, reason?: string }) => {
  let revoked
  try {
    revoked = await revokeApiKey(request)
  } catch (err: any) {
    console.error(`ERROR: The API key issuer could not be reached (${err?.message})`)
    return processError(100002, 'the key may or may not have been revoked; check the list', 500)
  }
  if (!revoked.ok) {
    if (revoked.error === 'not_found') return processError(100060, undefined, 404)
    return processError(100002, 'the key was not revoked', 500)
  }

  if (!(revoked as { alreadyRevoked: boolean }).alreadyRevoked) {
    const row = await getRecord(API_KEYS_TABLE, request.keyId)
    if (row.res) await notifyKeyOwner(row.res as ApiKeyRow, 'revoked', { staff: request.ownerId === undefined, reason: request.reason })
  }
  return response({ statusCode: 200, headers: null, bodyObject: { success: true, keyId: request.keyId, status: 'revoked' } })
}
