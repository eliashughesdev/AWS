import { Amplify } from 'aws-amplify'
import { fetchAuthSession, signIn, signOut } from 'aws-amplify/auth'

// The stack the account scripts call: main (staging), AWS account 129364817855, us-east-2
export const API_URL = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1'
// main's public API (loudiblyPublicApi): the only one that takes an API key
export const PUBLIC_API_URL = 'https://ceq15txvne.execute-api.us-east-2.amazonaws.com/v1'
const USER_POOL_ID = 'us-east-2_swAqXHlvm'
const USER_POOL_CLIENT_ID = '2m94cnohtb30i4s2c8jai1ovu0'

type Who = 'user' | 'staff'
const tokens = new Map<Who, Promise<string>>()
// Amplify holds one session at a time: sign-ins run one after another
let signingIn: Promise<unknown> = Promise.resolve()

/**
 * An access token for a test user of main's pool: E2E_USER_EMAIL / E2E_USER_PASSWORD, or for
 * 'staff' E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD (a user in the staff group). The account routes act
 * only for a signed-in user (utils/caller.ts): a merchant's HMAC key is refused there. Passwords
 * are never written into a file.
 */
export function accessToken(who: Who = 'user'): Promise<string> {
  let token = tokens.get(who)
  if (!token) {
    const prefix = who === 'staff' ? 'E2E_STAFF' : 'E2E_USER'
    token = signingIn.then(async () => {
      const username = process.env[`${prefix}_EMAIL`]
      const password = process.env[`${prefix}_PASSWORD`]
      if (!username || !password) {
        throw new Error(`Set ${prefix}_EMAIL and ${prefix}_PASSWORD to a test user of main's user pool`)
      }
      Amplify.configure({ Auth: { Cognito: { userPoolId: USER_POOL_ID, userPoolClientId: USER_POOL_CLIENT_ID } } })
      await signOut().catch(() => undefined)
      const result = await signIn({ username, password })
      if (!result.isSignedIn) throw new Error(`Sign-in wants another step: ${result.nextStep.signInStep}`)
      const access = (await fetchAuthSession()).tokens?.accessToken?.toString()
      if (!access) throw new Error('Signed in, but the session holds no access token')
      return access
    })
    signingIn = token.catch(() => undefined)
    tokens.set(who, token)
  }
  return token
}

// Answers the status, the headers and the parsed body (the text when it is not JSON)
export async function call(url: string, headers: Record<string, string>, body?: unknown) {
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data: any = text
  try {
    data = JSON.parse(text)
  } catch {}
  return { status: res.status, headers: res.headers, data }
}

// GET without a body, POST with one, on the internal API as the test user (or staff)
export async function callAsUser(path: string, body?: unknown, who: Who = 'user'): Promise<{ status: number, data: any }> {
  const { status, data } = await call(`${API_URL}${path}`, {
    Authorization: `Bearer ${await accessToken(who)}`,
    // API Gateway refuses a request without it before the authorizer runs; the frontends send 'web'
    'X-Project': 'web',
  }, body)
  return { status, data }
}

// The test user's accounts in a currency, from /accounts/list. Scripts take their account numbers
// from here: one written into a script belongs to whoever created it
export async function accountsFor(chain: string): Promise<string[]> {
  const { status, data } = await callAsUser('/accounts/list')
  if (status !== 200) throw new Error(`/accounts/list answered ${status}: ${JSON.stringify(data)}`)
  return (data.accounts ?? []).filter((a: any) => a.chain === chain).map((a: any) => a.accountNo)
}

export async function accountFor(chain: string): Promise<string> {
  const [account] = await accountsFor(chain)
  if (!account) throw new Error(`The test user has no ${chain} account; create one with AccountsAccountTest.ts`)
  return account
}

// Runs a script's main, printing a failure as one line and setting the exit code
export const run = (main: () => Promise<void>) => {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
