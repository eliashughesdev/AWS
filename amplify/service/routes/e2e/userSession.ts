import { Amplify } from 'aws-amplify'
import { fetchAuthSession, signIn } from 'aws-amplify/auth'

// The stack the account scripts call: main (staging), AWS account 129364817855, us-east-2
export const API_URL = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1'
const USER_POOL_ID = 'us-east-2_swAqXHlvm'
const USER_POOL_CLIENT_ID = '2m94cnohtb30i4s2c8jai1ovu0'

let token: Promise<string> | undefined

/**
 * An access token for the test user in E2E_USER_EMAIL / E2E_USER_PASSWORD, a user of main's pool.
 * The account routes act only for a signed-in user (utils/caller.ts): a merchant's HMAC key is
 * refused there. The password is never written into a file.
 */
export function accessToken(): Promise<string> {
  token ??= (async () => {
    const username = process.env.E2E_USER_EMAIL
    const password = process.env.E2E_USER_PASSWORD
    if (!username || !password) {
      throw new Error('Set E2E_USER_EMAIL and E2E_USER_PASSWORD to a test user of main\'s user pool')
    }
    Amplify.configure({ Auth: { Cognito: { userPoolId: USER_POOL_ID, userPoolClientId: USER_POOL_CLIENT_ID } } })
    const result = await signIn({ username, password })
    if (!result.isSignedIn) throw new Error(`Sign-in wants another step: ${result.nextStep.signInStep}`)
    const access = (await fetchAuthSession()).tokens?.accessToken?.toString()
    if (!access) throw new Error('Signed in, but the session holds no access token')
    return access
  })()
  return token
}

// GET without a body, POST with one. Answers the status and the parsed body (the text when it is not JSON)
export async function callAsUser(path: string, body?: unknown): Promise<{ status: number, data: any }> {
  const res = await fetch(`${API_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await accessToken()}`,
      // API Gateway refuses a request without it before the authorizer runs; the frontends send 'web'
      'X-Project': 'web',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  try {
    return { status: res.status, data: JSON.parse(text) }
  } catch {
    return { status: res.status, data: text }
  }
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
