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
