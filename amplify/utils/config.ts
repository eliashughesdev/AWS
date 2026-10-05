import { getSsmParametersByPath } from './ssm'

const SSM_PATH = '/loudibly/api/'

const TTL_MS = 60 * 1000

let lastFetchedAt = 0

/**
 * Loads all parameters from SSM under SSM_PATH and injects them into
 * process.env. Re-fetches at most once per minute so changes made in the SSM
 * console are picked up by all running Lambda containers within 60 seconds,
 * with no redeploy required.
 */
export async function loadConfig(): Promise<void> {
  const now = Date.now()
  if (now - lastFetchedAt < TTL_MS) return
  const params = await getSsmParametersByPath(SSM_PATH)
  if (Object.keys(params).length === 0) {
    throw new Error(`No SSM parameters found under ${SSM_PATH}`)
  }
  console.log(`DEBUG: loaded ${Object.keys(params).length} config params from ${SSM_PATH}`)
  Object.assign(process.env, params)
  lastFetchedAt = now
}

/**
 * Brand name for user-facing email. No default on purpose — a fallback would
 * quietly ship the wrong brand. Call after loadConfig().
 */
export function brandName(): string {
  const name = process.env.BRAND_NAME
  if (!name) throw new Error(`BRAND_NAME is not set under ${SSM_PATH}`)
  return name
}

/**
 * How new custodial accounts and masters get their key: `kms` (one KMS key
 * each, the default) or `hd` (an address under the merchant's seed). Set
 * CUSTODY_KEY_MODEL to `hd` only once the environment's seeds exist. An
 * existing account keeps the model it was created with.
 */
export function custodyKeyModel(): 'kms' | 'hd' {
  return process.env.CUSTODY_KEY_MODEL === 'hd' ? 'hd' : 'kms'
}

const DEFAULT_CLAIM_TOKEN_TTL_SECONDS = 7 * 86_400

/**
 * How long a password-claim link stays valid, in seconds. Seconds (not days)
 * so a short TTL can be set for testing without editing code. Unlike
 * BRAND_NAME this falls back to a default instead of throwing — an unset or
 * malformed value isn't a wrong-brand-class mistake, just a shorter/longer
 * link lifetime.
 */
export function claimTokenTtlSeconds(): number {
  const raw = Number(process.env.CLAIM_TOKEN_TTL_SECONDS)
  return raw > 0 ? raw : DEFAULT_CLAIM_TOKEN_TTL_SECONDS
}
