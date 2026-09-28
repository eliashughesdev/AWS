import crypto from 'crypto'

// Needs an access token from a Cognito user in the `staff` group (~1h TTL) —
// grab it from the browser (devtools → local storage → the Amplify key ending
// in `.accessToken`). Sign out and back in after being added to the group.
const token = process.env.STAFF_TOKEN ?? ''

const baseUrl = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com'

const register = async () => {
  const res = await fetch(`${baseUrl}/v1/merchants/register`, {
    method: 'POST',
    body: JSON.stringify({ name: `E2E Merchant ${Date.now()}` }),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Project': 'web',
      'Authorization': `Bearer ${token}`,
    },
  })
  return res.json()
}

const listWithMerchantKey = async (merchantId: string, apiKey: string) => {
  const path = '/v1/accounts/list'
  const bodyHash = crypto.createHash('md5').update('').digest('hex')
  const timestamp = Date.now()
  const signature = crypto
    .createHmac('sha256', Buffer.from(apiKey, 'hex'))
    .update(`${path}${timestamp}${bodyHash}`)
    .digest('base64')

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Project': merchantId,
      'Authorization': `Signature ${timestamp}:${bodyHash}:${signature}`,
    },
  })
  return { status: res.status, body: await res.json() }
}

register()
  .then(async data => {
    console.log('register: ', data)
    if (!data.merchantId) return
    console.log('list with merchant key: ', await listWithMerchantKey(data.merchantId, data.apiKey))
  })
  .catch(err => console.log(err))
