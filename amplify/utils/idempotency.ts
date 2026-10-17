import { createHash } from 'crypto'
import { queryRecord, updateItem } from './db'
import { processError } from '../errors/http'

/**
 * Idempotency-Key for the POSTs that move money (docs/public-api-plan.md D6.1, step 1.4).
 *
 * The first request with a key claims it: a row `id = IDEM#<caller>#<key>`, `sk = IDEMPOTENCY` in
 * v2CustomerTable, written only if none is there (or the one there has expired). The response is
 * stored on it when the handler answers, and a retry with the same key and the same request gets
 * that response again, marked `Idempotent-Replayed: true`, without running anything. Rows expire
 * after 24 hours (the table's `ttl`).
 *
 * - the same key with another request (method, path or body): 409 100061
 * - the same key while the first is still running: 409 100061
 * - a handler that throws leaves its key claimed until it expires: nobody can tell whether the
 *   money moved, so it is never run again on its own. The caller checks, then uses a new key.
 */

export const IDEMPOTENCY_SK = 'IDEMPOTENCY'
const TTL_SECONDS = 24 * 60 * 60
// What a client may send: Stripe-style keys and UUIDs, nothing that needs escaping
const KEY = /^[A-Za-z0-9_.:-]{1,255}$/

type Outcome = { statusCode: number, headers?: object | null, body: string }

// JSON with keys sorted at every level, so a retry that orders its fields differently is the same
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as any)[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export const requestHash = (method: string, path: string, body: unknown) =>
  createHash('sha256').update(`${method} ${path}\n${canonical(body)}`).digest('hex')

// The header's value, whatever case the client wrote its name in
export const idempotencyKeyOf = (headers: Record<string, string | undefined> | null | undefined) =>
  Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1]

const conflict = (reason: 'another-request' | 'running') => processError(100061, reason, 409)

/**
 * Runs `run` at most once per caller and key. `caller` scopes the key (a user's id, or a merchant's
 * for its key); `path` is the route's path or template, so the same key on two routes conflicts.
 * With no key: `required` answers 100029, otherwise `run` simply runs.
 */
export async function withIdempotency({ caller, key, method, path, body, required, run }: {
  caller: string
  key: string | undefined
  method: string
  path: string
  body: unknown
  required: boolean
  run: () => Promise<Outcome>
}): Promise<Outcome> {
  if (key === undefined || key === '') return required ? processError(100029, 'Idempotency-Key') : run()
  if (!KEY.test(key)) return processError(100031, 'Idempotency-Key')

  const id = `IDEM#${caller}#${key}`
  const hash = requestHash(method, path, body)
  const now = Math.floor(Date.now() / 1000)

  const claimed = await updateItem({
    tableName: 'v2CustomerTable',
    key: { id, sk: IDEMPOTENCY_SK },
    // An expired row may linger until DynamoDB removes it: it counts as none
    updateExpression: 'SET #state = :running, requestHash = :hash, createdAt = :now, #ttl = :expires REMOVE statusCode, responseBody',
    conditionExpression: 'attribute_not_exists(id) OR #ttl < :now',
    attributeNames: { '#state': 'state', '#ttl': 'ttl' },
    attributeValues: { ':running': 'running', ':hash': hash, ':now': now, ':expires': now + TTL_SECONDS },
  })

  if (!claimed.success) {
    if (claimed.error?.name !== 'ConditionalCheckFailedException') {
      console.error('ERROR: The idempotency key could not be claimed')
      return processError(100002, 'the request could not be started; nothing was done', 500)
    }
    const existing = await queryRecord('v2CustomerTable', 'id = :id AND sk = :sk', { ':id': id, ':sk': IDEMPOTENCY_SK }, true)
    const row = existing.res?.[0]
    if (!existing.success || !row) {
      console.error('ERROR: The idempotency key is taken but its row could not be read')
      return processError(100002, 'the request could not be checked; nothing was done', 500)
    }
    if (row.requestHash !== hash) return conflict('another-request')
    if (row.state !== 'done') return conflict('running')
    console.log(`IDEMPOTENCY: replaying the answer to ${method} ${path}`)
    return {
      statusCode: row.statusCode,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Idempotent-Replayed': 'true' },
      body: row.responseBody,
    }
  }

  // A throw propagates and leaves the key claimed (see above)
  const outcome = await run()

  const stored = await updateItem({
    tableName: 'v2CustomerTable',
    key: { id, sk: IDEMPOTENCY_SK },
    updateExpression: 'SET #state = :done, statusCode = :status, responseBody = :body',
    attributeNames: { '#state': 'state' },
    attributeValues: { ':done': 'done', ':status': outcome.statusCode, ':body': outcome.body },
  })
  // The operation ran; the caller gets its answer. A retry will see the key running and get 409
  if (!stored.success) console.error('ERROR: The answer could not be stored under its idempotency key')
  return outcome
}
