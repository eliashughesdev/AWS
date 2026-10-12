const jsonwebtoken = require('jsonwebtoken')
const crypto = require('crypto')
const { getRecord } = require('./db')
const jwkToPem = require('jwk-to-pem')

const generatePolicy = (principalId, effect, resource, role = 'user') => {
  console.log('DEBUG: Generating policy:', { principalId, effect, resource, role })
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{
        Effect: effect,
        Action: 'execute-api:Invoke',
        Resource: resource,
      }]
    },
    context: {
      userId: principalId,
      role,
    }
  }
}

// Logs here never name the Authorization header, a signature, a JWT, the event or a key record:
// CloudWatch keeps them, and v1UserKeysTable's key is the secret a merchant signs with
const handler = async (event) => {
  console.log('DEBUG: --- HANDLER START ---')
  const resource = event.methodArn
  console.log('DEBUG: Resource ARN:', resource)
  const auth = event.headers?.Authorization
  const project = event.headers?.['X-Project']
  console.log('DEBUG: X-Project Header (Key ID):', project)
  const sourceIp = event.requestContext.identity.sourceIp
  console.log('DEBUG: Source IP:', sourceIp)

  if (auth?.includes('Signature') && !project) {
    console.log('DEBUG: Deny: Signature provided but X-Project missing.')
    return generatePolicy(sourceIp, 'Deny', resource)
  }

  try {
    console.log('DEBUG: Entering Try Block')
    if (auth?.includes('Bearer')) {
      console.log('DEBUG: Auth Type: Bearer (JWT)')
      const res = await authenticateWithJWT({ event })
      console.log('DEBUG: JWT Result:', res.isValid, res.message ?? '')
      if (!res.isValid) return generatePolicy(sourceIp, 'Deny', resource)
      const groups = res.claim['cognito:groups'] ?? []
      const role = groups.includes('staff') ? 'staff' : groups.includes('admin') ? 'admin' : groups.includes('merchant') ? 'merchant' : 'user'
      console.log('DEBUG: JWT Role resolved:', role)
      return generatePolicy(res.claim.sub, 'Allow', resource, role)
    } else if (auth?.includes('Signature')) {
      console.log('DEBUG: Auth Type: Signature (HMAC/RSA)')
      const keys = await getRecord('v1UserKeysTable', project)
      console.log('DEBUG: Key found for X-Project:', !!keys.res)

      const b = auth.replace('Signature ', '')

      const chunks = b.split(':') // 0 - timestamp, 1 - bodyHash, 2 - signature
      const [timestamp, bodyHash, requestSignature] = chunks.map(c => c.trim())

      console.log('DEBUG: Signed at:', timestamp, 'BodyHash:', bodyHash)

      const timestampDiff = Date.now() - parseInt(timestamp)
      if (timestampDiff > 10000) {
        console.log(`DEBUG: Deny: Old timestamp. Diff: ${timestampDiff}ms`)
        return generatePolicy(sourceIp, 'Deny', resource)
      }
      console.log('DEBUG: Timestamp is fresh.')

      const pathForSigning = event.requestContext.path.trim()

      const mix = `${pathForSigning}${timestamp}${bodyHash}`

      console.log('DEBUG: pathForSigning (Used):', pathForSigning)
      console.log('DEBUG: String to Sign (mix):', mix)

      const types = {
        rsa: () => authenticateWithSHA256WithRSA(mix, requestSignature, keys.res.key),
        hmac: () => authenticateWithHmacWithKey(mix, requestSignature, keys.res.key)
      }
      console.log('DEBUG: Authentication Type:', keys.res.type)
      const res = types[keys.res.type]()
      console.log('res: ', res)
      // HMAC/RSA keys are B2B service clients — treated as admin
      return generatePolicy(project, res.isValid ? 'Allow' : 'Deny', resource, 'admin')
    }
  } catch (e) {
    console.log('DEBUG: Catch block executed. Error:', e)
    return generatePolicy(sourceIp, 'Deny', resource)
  }
  console.log('DEBUG: Final Deny (No Auth Type Matched)')
  return generatePolicy(sourceIp, 'Deny', resource)
}

/**
 * Encryption method SHA256 HMAC
 * gather key prior to signature verification
 * concatenate values of sorted by key object
 * create HMAC signature and return base64 value
 * @param {string} body
 * @param {string} requestSignature
 * @param {string} key
 * @return {{isValid: boolean}}
 */
const authenticateWithHmacWithKey = (body, requestSignature, key) => {
  console.log('DEBUG HMAC: String to Sign:', body)

  const trimmedKey = key.trim()

  const signature = crypto
    .createHmac('sha256', Buffer.from(trimmedKey, 'hex'))
    .update(body)
    .digest('base64')

  console.log('DEBUG HMAC: Signatures Match:', signature === requestSignature)

  return { isValid: signature === requestSignature }
}

/**
 * Authenticates API request for JWT token for specific Cognito pool
 * @return Promise<{isValid: boolean}>
 */
// @ts-ignore
const authenticateWithJWT = async ({ event, region = process.env.AWS_REGION, userPoolId = process.env.COGNITO_USER_POOL_ID, }) => {
  const cognitoIssuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`

  console.log('DEBUG JWT: Region:', region)
  console.log('DEBUG JWT: User Pool ID:', userPoolId)
  console.log('DEBUG JWT: Cognito Issuer:', cognitoIssuer)

  let cacheKeys
  const getPublicKeys = async () => {
    if (!cacheKeys) {
      console.log('DEBUG JWT: Fetching public keys from:', `${cognitoIssuer}/.well-known/jwks.json`)

      const res = await fetch(`${cognitoIssuer}/.well-known/jwks.json`)

      console.log('DEBUG JWT: Fetch response status:', res.status)

      if (!res.ok) {
        console.error('DEBUG JWT: Failed to fetch public keys. Status:', res.status)
        throw new Error(`Failed to fetch JWKS: ${res.status}`)
      }

      const publicKeys = await res.json()

      console.log('DEBUG JWT: Public keys response:', JSON.stringify(publicKeys))

      if (!publicKeys.keys || !Array.isArray(publicKeys.keys)) {
        console.error('DEBUG JWT: Invalid JWKS response - keys array missing')
        throw new Error('Invalid JWKS response')
      }

      cacheKeys = publicKeys.keys.reduce((agg, current) => {
        const pem = jwkToPem(current)
        agg[current.kid] = { instance: current, pem }
        return agg
      }, {})

      console.log('DEBUG JWT: Cached keys:', Object.keys(cacheKeys))
      return cacheKeys
    } else {
      console.log('DEBUG JWT: Using cached keys')
      return cacheKeys
    }
  }

  const verifyPromised = (tk, pem) => {
    return new Promise((resolve, reject) => {
      try {
        const res = jsonwebtoken.verify(tk, pem)
        resolve(res)
      } catch (e) {
        reject(e)
      }
    })
  }

  /**
     * Check claims
     * @param event
     */
  const checkClaims = async (event) => {
    try {
      console.log('DEBUG JWT: Starting checkClaims.')
      const authorization = event.headers.Authorization || event.headers.authorization
      const token = authorization.split(' ')[1] // Authorization: Bearer {token}
      console.log('DEBUG JWT: Token extracted:', token ? 'Yes' : 'No')
      const tokenSections = (token || '').split('.')
      if (tokenSections.length < 2) return { isValid: false, message: 'requested token is invalid' }
      const headerJSON = Buffer.from(tokenSections[0], 'base64').toString('utf8')
      const header = JSON.parse(headerJSON)
      console.log('DEBUG JWT: Token Header KID:', header.kid)
      const keys = await getPublicKeys()
      const key = keys?.[header.kid]
      if (!key) return { isValid: false, message: 'claim made for unknown kid' }
      // @ts-ignore
      const claim = await verifyPromised(token, key.pem)
      console.log('DEBUG JWT: Claim verified successfully.')
      const currentSeconds = Math.floor(new Date().valueOf() / 1000)
      if (currentSeconds > claim.exp || currentSeconds < claim.auth_time) return { isValid: false, message: 'claim is expired or invalid' }
      if (claim.iss !== cognitoIssuer) return { isValid: false, message: 'claim issuer is invalid' }
      if (claim.token_use !== 'access') return { isValid: false, message: 'claim use is not access' }

      console.log(`claim confirmed for ${claim.sub}, groups ${JSON.stringify(claim['cognito:groups'] ?? [])}`)
      return { isValid: true, claim }
    } catch (error) {
      console.log('DEBUG JWT: checkClaims caught error:', error)
      return { isValid: false, message: 'Something went wrong' }
    }
  }
  return await checkClaims(event)
}



/**
 * Encryption Method: SHA256 with RSA
 * Merchant private key: PKCS8
 * Signature Algorithm: Base64 encryption after hashing
 * Key Length : 2048
 * Padding: RSA_PKCS1_PADDING
 *
 * Private Key Generation:
 * openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out private.key.pem
 * Extract Public Key
 * openssl rsa -in private.key.pem -pubout > public.key.pem
 * @param body raw body data from request
 * @param requestSignature
 * @param publicKey public key for customer project
 * @return {{isValid: boolean}}
 */
const authenticateWithSHA256WithRSA = (body, requestSignature, publicKey) => {
  console.log('DEBUG RSA: Starting authenticateWithSHA256WithRSA')
  try {
    const isValid = crypto
      .verify(
        'RSA-SHA256',
        Buffer.from(body),
        {
          key: publicKey,
          padding: crypto.constants.RSA_PKCS1_PADDING
        },
        Buffer.from(requestSignature, 'base64')
      )
    console.log('DEBUG RSA: Verification result:', isValid)
    return { isValid }
  } catch (e) {
    console.log('DEBUG RSA: Verification error:', e)
    return { isValid: false }
  }
}

module.exports = { handler }
