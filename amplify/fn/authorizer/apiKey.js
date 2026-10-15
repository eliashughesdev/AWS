const crypto = require('crypto')
const net = require('net')
const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb')
const { GetParameterCommand, SSMClient } = require('@aws-sdk/client-ssm')
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb')

/**
 * API keys: `Authorization: Basic base64(<keyId>:<secret>)` (docs/public-api-plan.md D1.3, D2.3).
 *
 * A key is let in only when, in this order: its row in v1ApiKeysTable is there, active and not
 * expired; the caller's IP is on its allowlist (an empty or missing list: any IP); the SHA-256 of
 * the secret equals the hash kept in SSM under /loudibly/api-keys/<keyId> (compared in constant
 * time); and its owner is still active. The row is read on every call, so a revoked key or a
 * changed allowlist applies at once; only the hash is cached, since a key's hash never changes.
 *
 * Keys work on the public API only: the internal API's stage has no API_SURFACE (the router
 * answers 404 too, D2.4).
 *
 * Nothing here logs the header, the secret, the hash or a row: only key ids and why one was let in
 * or not.
 */

// Names set in amplify/utils/apiKeyStore.ts; this function is plain JS and cannot import it
const KEYS_TABLE = 'v1ApiKeysTable'
const PARAMETER_PREFIX = '/loudibly/api-keys/'
// PUBLIC_API_SURFACE in amplify/service/publicRoutes.ts
const PUBLIC_SURFACE = 'public'

const KEY_ID = /^lk_live_[0-9a-f]{16}$/
const SECRET = /^lks_[A-Za-z0-9_-]{43}$/

const HASH_TTL_MS = 10 * 60 * 1000
const LAST_USED_EVERY_MS = 60 * 1000

const db = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-2' })
const ssm = new SSMClient({ region: process.env.AWS_REGION || 'us-east-2' })

// keyId → { hash, until }: kept for the life of the container, at most HASH_TTL_MS
const hashes = new Map()
// keyId → when this container last wrote its lastUsedAt
const lastUsedWritten = new Map()

const isBasic = (authorization) => typeof authorization === 'string' && /^Basic\s/i.test(authorization)

// { keyId, secret } from the header, or null when it is not a key of ours
const parseBasic = (authorization) => {
  const encoded = authorization.replace(/^Basic\s+/i, '').trim()
  let decoded
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8')
  } catch {
    return null
  }
  const colon = decoded.indexOf(':')
  if (colon < 0) return null
  const keyId = decoded.slice(0, colon)
  const secret = decoded.slice(colon + 1)
  return KEY_ID.test(keyId) && SECRET.test(secret) ? { keyId, secret } : null
}

// One spelling per address, so '2001:DB8::1' and '2001:db8:0:0:0:0:0:1' are the same entry, and an
// IPv4 address API Gateway gives as IPv6 (::ffff:203.0.113.7) is its IPv4 one
const normalizeIp = (ip) => {
  if (typeof ip !== 'string') return null
  const trimmed = ip.trim()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed)
  if (mapped) return mapped[1]
  if (net.isIPv4(trimmed)) return trimmed
  if (net.isIPv6(trimmed)) return new URL(`http://[${trimmed}]`).hostname.slice(1, -1)
  return null
}

const ipAllowed = (allowlist, sourceIp) => {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return true
  const caller = normalizeIp(sourceIp)
  return caller !== null && allowlist.some(entry => normalizeIp(entry) === caller)
}

const getItem = async (table, key) => {
  const res = await db.send(new GetItemCommand({ TableName: table, Key: marshall(key), ConsistentRead: true }))
  return res.Item ? unmarshall(res.Item) : null
}

// The hash of the key's secret, hex, or null when it has none (revoked, or never written)
const storedHash = async (keyId) => {
  const cached = hashes.get(keyId)
  if (cached && cached.until > Date.now()) return cached.hash
  try {
    const res = await ssm.send(new GetParameterCommand({ Name: `${PARAMETER_PREFIX}${keyId}`, WithDecryption: true }))
    const hash = res.Parameter?.Value
    if (!hash) return null
    hashes.set(keyId, { hash, until: Date.now() + HASH_TTL_MS })
    return hash
  } catch (err) {
    if (err?.name === 'ParameterNotFound') return null
    throw err
  }
}

const secretMatches = (secret, hash) => {
  if (!/^[0-9a-f]{64}$/.test(hash)) return false
  const given = crypto.createHash('sha256').update(secret).digest()
  return crypto.timingSafeEqual(given, Buffer.from(hash, 'hex'))
}

const ownerActive = async (row) => {
  if (row.ownerType === 'user') {
    const profile = await getItem('v2CustomerTable', { id: row.ownerId, sk: 'USERPROFILE' })
    return !!profile && !profile.deleted_at
  }
  if (row.ownerType === 'merchant') {
    const profile = await getItem('v1MerchantTable', { id: row.ownerId, sk: 'PROFILE' })
    return profile?.status === 'active'
  }
  return false
}

// When the key was last used, to the minute: never more than one write a minute per key, across
// containers too (the condition), and a failure never refuses the call
const touch = async (keyId) => {
  const now = Date.now()
  if (now - (lastUsedWritten.get(keyId) ?? 0) < LAST_USED_EVERY_MS) return
  lastUsedWritten.set(keyId, now)
  try {
    await db.send(new UpdateItemCommand({
      TableName: KEYS_TABLE,
      Key: marshall({ id: keyId }),
      UpdateExpression: 'SET lastUsedAt = :now',
      ConditionExpression: 'attribute_exists(id) AND (attribute_not_exists(lastUsedAt) OR lastUsedAt < :minuteAgo)',
      ExpressionAttributeValues: marshall({ ':now': new Date(now).toISOString(), ':minuteAgo': new Date(now - LAST_USED_EVERY_MS).toISOString() }),
    }))
  } catch (err) {
    if (err?.name !== 'ConditionalCheckFailedException') console.log(`API_KEY: ${keyId} lastUsedAt not written (${err?.name})`)
  }
}

/**
 * Checks a Basic header. Answers { allowed: false, reason } or { allowed: true, keyId, context },
 * the context being what the API gets in requestContext.authorizer: strings only.
 * Throws when a table or SSM could not be read; the caller denies.
 */
const authenticateWithApiKey = async ({ authorization, sourceIp, stageVariables }) => {
  if (stageVariables?.API_SURFACE !== PUBLIC_SURFACE) return { allowed: false, reason: 'not the public API' }

  const credentials = parseBasic(authorization)
  if (!credentials) return { allowed: false, reason: 'not an API key' }
  const { keyId, secret } = credentials

  const row = await getItem(KEYS_TABLE, { id: keyId })
  if (!row) return { allowed: false, keyId, reason: 'unknown key' }
  if (row.status !== 'active') return { allowed: false, keyId, reason: `key ${row.status}` }
  if (row.expiresAt && !(Date.parse(row.expiresAt) > Date.now())) return { allowed: false, keyId, reason: 'key expired' }
  if (!ipAllowed(row.ipAllowlist, sourceIp)) return { allowed: false, keyId, reason: 'IP not on the allowlist' }

  const hash = await storedHash(keyId)
  if (!hash || !secretMatches(secret, hash)) return { allowed: false, keyId, reason: 'wrong secret' }

  if (!(await ownerActive(row))) return { allowed: false, keyId, reason: `${row.ownerType} not active` }

  await touch(keyId)

  const merchantKey = row.ownerType === 'merchant'
  return {
    allowed: true,
    keyId,
    principalId: row.ownerId,
    context: {
      userId: row.ownerId,
      // A merchant's key acts as its HMAC key does; a user's as its owner signed in
      role: merchantKey ? 'admin' : 'user',
      authType: 'apikey',
      ownerType: row.ownerType,
      keyId,
      permissions: [...(row.permissions ?? [])].join(','),
      ...(merchantKey ? { merchantId: row.ownerId } : {}),
    },
  }
}

// For tests: a container starts with nothing cached
const resetCaches = () => {
  hashes.clear()
  lastUsedWritten.clear()
}

module.exports = { authenticateWithApiKey, isBasic, normalizeIp, parseBasic, resetCaches }
