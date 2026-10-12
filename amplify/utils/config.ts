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

const DEFAULT_FRONTEND_APP_PATH = '/v2'

/**
 * Address of the UI that emailed links open: FRONTEND_URL plus the folder in
 * FRONTEND_APP_PATH, with no trailing slash. An unset path means /v2 and "/"
 * the site root. Undefined when FRONTEND_URL is unset — each caller decides
 * what that means. Call after loadConfig().
 */
export function frontendAppUrl(): string | undefined {
  const site = process.env.FRONTEND_URL?.trim().replace(/\/+$/, '')
  if (!site) return undefined
  const path = (process.env.FRONTEND_APP_PATH?.trim() || DEFAULT_FRONTEND_APP_PATH).replace(/^\/+|\/+$/g, '')
  return path ? `${site}/${path}` : site
}
