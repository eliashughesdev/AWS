import { API_URL, PUBLIC_API_URL, call, callAsUser, run } from '../userSession'

/**
 * API keys end to end on main (docs/public-api-plan.md step 2.7):
 * - the test user creates a key with accounts:read, calls /accounts/list on the public API with
 *   it, is refused a route it holds no permission for (403 100055), goes over the limit staff set
 *   (429 100056 with Retry-After), revokes it, and is refused from then on;
 * - staff create a key for the e2e-hmac merchant, which onboards a payer on the public API and is
 *   refused on /accounts/list, a user's route (403 100053), then revoke it.
 *
 * Needs E2E_USER_EMAIL / E2E_USER_PASSWORD and E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD (a user in the
 * staff group), both of main's pool. The secrets are never printed. Each key is revoked at the end,
 * also when a check failed, so runs never pile up against the 10-key limit.
 */

const MERCHANT = 'e2e-hmac'

const basic = (keyId: string, secret: string) =>
  ({ Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString('base64')}` })

const withKey = (key: Key, path: string, body?: unknown) => call(`${PUBLIC_API_URL}${path}`, basic(key.keyId, key.secret), body)

type Key = { keyId: string, secret: string }

function check(ok: boolean, what: string, got?: unknown) {
  if (!ok) throw new Error(`FAIL ${what}${got === undefined ? '' : `: ${JSON.stringify(got)}`}`)
  console.log(`ok   ${what}`)
}

async function created(res: { status: number, data: any }, what: string): Promise<Key> {
  check(res.status === 200 && typeof res.data?.secret === 'string', what, res.status === 200 ? { ...res.data, secret: '[hidden]' } : res.data)
  return { keyId: res.data.key.keyId, secret: res.data.secret }
}

async function userKey() {
  const key = await created(await callAsUser('/accounts/api-keys/create', {
    name: `e2e ${new Date().toISOString()}`,
    permissions: ['accounts:read'],
  }), 'user creates a key with accounts:read')

  try {
    const listed = await callAsUser('/accounts/api-keys/list')
    const row = listed.data?.keys?.find((k: any) => k.keyId === key.keyId)
    check(listed.status === 200 && row?.status === 'active' && !JSON.stringify(listed.data).includes(key.secret),
      'the key is listed, active, without its secret', listed.status)

    const accounts = await withKey(key, '/accounts/list')
    check(accounts.status === 200 && Array.isArray(accounts.data?.accounts), 'the key reads /accounts/list on the public API', accounts.data)
    check(accounts.headers.get('x-ratelimit-limit') !== null, 'the answer carries X-RateLimit-Limit', accounts.headers.get('x-ratelimit-limit'))

    const internal = await call(`${API_URL}/accounts/list`, basic(key.keyId, key.secret))
    check(internal.status === 401 || internal.status === 403, 'the key is refused on the internal API', internal.status)

    const kyc = await withKey(key, '/accounts/kyc/status')
    check(kyc.status === 403 && kyc.data?.error_code === 100055, 'a route it holds no permission for answers 403 100055', kyc.data)

    const manage = await call(`${API_URL}/accounts/api-keys/list`, basic(key.keyId, key.secret))
    check(manage.status === 401 || manage.status === 403, 'the key cannot manage keys', manage.status)

    const limited = await callAsUser('/merchants/api-keys/rate-limit', { keyId: key.keyId, perSecond: 1 }, 'staff')
    check(limited.status === 200, 'staff set the key to 1 call a second', limited.data)
    const notStaff = await callAsUser('/merchants/api-keys/rate-limit', { keyId: key.keyId, perSecond: 1000 })
    check(notStaff.status === 403, 'the user cannot change their own limit', notStaff.status)

    const burst = await Promise.all(Array.from({ length: 6 }, () => withKey(key, '/accounts/list')))
    const throttled = burst.find(r => r.status === 429)
    check(!!throttled && throttled.data?.error_code === 100056 && !!throttled.headers.get('retry-after'),
      'a burst over the limit answers 429 100056 with Retry-After', burst.map(r => r.status))
  } finally {
    const revoked = await callAsUser('/accounts/api-keys/revoke', { keyId: key.keyId })
    check(revoked.status === 200 && revoked.data?.status === 'revoked', 'user revokes the key', revoked.data)
  }

  const again = await callAsUser('/accounts/api-keys/revoke', { keyId: key.keyId })
  check(again.status === 200, 'revoking it again still answers success', again.data)
  const after = await withKey(key, '/accounts/list')
  check(after.status === 401 || after.status === 403, 'the revoked key is refused', after.status)
}

async function merchantKey() {
  const refused = await callAsUser('/merchants/api-keys/create', { merchantId: MERCHANT, name: 'e2e', permissions: ['users:create'] })
  check(refused.status === 403, 'a user cannot create a merchant key', refused.status)

  const key = await created(await callAsUser('/merchants/api-keys/create', {
    merchantId: MERCHANT,
    name: `e2e ${new Date().toISOString()}`,
    permissions: ['users:create'],
  }, 'staff'), `staff create a key for ${MERCHANT} with users:create`)

  try {
    const stamp = Date.now()
    const onboarded = await withKey(key, '/accounts/onboarding', {
      externalId: `ext_${stamp}`,
      firstName: 'Juan',
      lastName: 'Perez',
      email: `success+${stamp}@simulator.amazonses.com`,
      chain: 'TRON',
      transaction: { id: `txn_${stamp}`, amount: 50.0, currency: 'EUR', paidAt: new Date().toISOString() },
    })
    check(onboarded.status < 300 && onboarded.data?.success === true && !!onboarded.data?.res?.data?.userId,
      `the merchant key onboards a payer (${onboarded.status})`, onboarded.data)

    const accounts = await withKey(key, '/accounts/list')
    check(accounts.status === 403, 'the merchant key is refused on /accounts/list', accounts.data)

    const listed = await callAsUser(`/merchants/api-keys/list?merchantId=${MERCHANT}&status=active`, undefined, 'staff')
    check(listed.status === 200 && listed.data?.keys?.some((k: any) => k.keyId === key.keyId), 'staff list the merchant\'s keys', listed.status)
  } finally {
    const revoked = await callAsUser('/merchants/api-keys/revoke', { keyId: key.keyId, reason: 'e2e run finished' }, 'staff')
    check(revoked.status === 200, 'staff revoke the merchant key', revoked.data)
  }
  const after = await withKey(key, '/accounts/onboarding', {})
  check(after.status === 401 || after.status === 403, 'the revoked merchant key is refused', after.status)
}

run(async () => {
  await userKey()
  await merchantKey()
  console.log('all API key checks passed')
})
