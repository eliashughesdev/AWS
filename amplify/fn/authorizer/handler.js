const jwkToPem = require('jwk-to-pem')
const jsonwebtoken = require('jsonwebtoken')
const crypto = require('crypto')
const { getRecord } = require('./db')

const generatePolicy = (principalId, effect, resource) => {
	return {
		principalId: principalId,
		policyDocument: {
			Version: '2012-10-17',
			Statement: [{
				Effect: effect,
				Action: 'execute-api:Invoke',
				Resource: resource,
			}]
		},
		context: {
			userId: principalId
		}
	}
}

const handler = async (event) => {
	const resource = event.methodArn
	const auth = event.headers?.Authorization
	const project = event.headers?.['X-Project']
	const sourceIp = event.requestContext.identity.sourceIp

	console.log('AuthorizerFn: ', event)

	if (auth.includes('Signature') && !project) {
		return generatePolicy(sourceIp, 'Deny', resource)
	}

	try {
		if (auth.includes('Bearer')) {
			const res = await authenticateWithJWT({ event })
			return generatePolicy(res.claim.sub, res.isValid ? 'Allow' : 'Deny', resource)
		} else if (auth.includes('Signature')) {
			const keys = await getRecord('v1UserKeysTable', project)
			console.log('db.keys: ', keys)
			const b = auth.replace('Signature ', '')
			const chunks = b.split(':') // 0 - timestamp, 1 - bodyHash, 2 - signature
			if (Date.now() - parseInt(chunks[0]) > 10000) {
				console.log('old timestamp')
				return generatePolicy(sourceIp, 'Deny', resource)
			} // replay
			const mix = `${event.path}${chunks[0]}${chunks[1]}`
			const types = {
				rsa: () => authenticateWithSHA256WithRSA(mix, chunks[2], keys.res.key),
				hmac: () => authenticateWithHmacWithKey(mix, chunks[2], keys.res.key)
			}
			const res = types[keys.res.type]()
			console.log('res: ', res)
			return generatePolicy(project, res.isValid ? 'Allow' : 'Deny', resource)
		}
	} catch (e) {
		return generatePolicy(sourceIp, 'Deny', resource)
	}
	return generatePolicy(sourceIp, 'Deny', resource)
}

/**
 * Authenticates API request for JWT token for specific Cognito pool
 * @return Promise<{isValid: boolean}>
 */
// @ts-ignore
const authenticateWithJWT = async ({ event, region = process.env.AWS_REGION, userPoolId = process.env.COGNITO_USER_POOL_ID, }) => {
	const cognitoIssuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`
	let cacheKeys
	const getPublicKeys = async () => {
		if (!cacheKeys) {
			const res = await fetch(`${cognitoIssuer}/.well-known/jwks.json`)
			const publicKeys = await res.json()
			cacheKeys = publicKeys.keys.reduce((agg, current) => {
				const pem = jwkToPem(current)
				agg[current.kid] = { instance: current, pem }
				return agg
			})
			return cacheKeys
		} else {
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
			const authorization = event.headers.Authorization || event.headers.authorization
			console.log(`user claim verify invoked for ${JSON.stringify(authorization)}`)
			const token = authorization.split(' ')[1] // Authorization: Bearer {token}
			const tokenSections = (token || '').split('.')
			if (tokenSections.length < 2) return { isValid: false, message: 'requested token is invalid' }
			const headerJSON = Buffer.from(tokenSections[0], 'base64').toString('utf8')
			const header = JSON.parse(headerJSON)
			const keys = await getPublicKeys()
			const key = keys?.[header.kid]
			if (!key) return { isValid: false, message: 'claim made for unknown kid' }
			// @ts-ignore
			const claim = await verifyPromised(token, key.pem)
			const currentSeconds = Math.floor(new Date().valueOf() / 1000)
			if (currentSeconds > claim.exp || currentSeconds < claim.auth_time) return { isValid: false, message: 'claim is expired or invalid' }
			if (claim.iss !== cognitoIssuer) return { isValid: false, message: 'claim issuer is invalid' }
			if (claim.token_use !== 'access') return { isValid: false, message: 'claim use is not access' }
			// const groups = []
			// if (Object.prototype.hasOwnProperty.call(claim, 'cognito:groups')) {
			// 	for (const i of claim['cognito:groups']) {
			// 		groups.push(i)
			// 	}
			// }
			console.log(`claim confirmed for ${claim.username}`)
			console.log(JSON.stringify(claim))
			return { isValid: true, claim }
		} catch (error) {
			console.log(error)
			return { isValid: false, message: 'Something went wrong' }
		}
	}
	await checkClaims(event)
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
	const signature = crypto
		.createHmac('sha256', Buffer.from(key, 'hex'))
		.update(body)
		.digest('base64')
	console.log(signature)
	return { isValid: signature === requestSignature }
}



/**
 * Encryption Method: SHA256 with RSA
 * Merchant private key: PKCS8
 * Signature Algorithm: Base64 encryption after hashing
 * Key Length : 2048
 * Padding: RSA_PKCS1_PADDING
 *
 * Private Key Generation:
 *   openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out private.key.pem
 * Extract Public Key
 *   openssl rsa -in private.key.pem -pubout > public.key.pem
 * @param body raw body data from request
 * @param requestSignature
 * @param publicKey public key for customer project
 * @return {{isValid: boolean}}
 */
const authenticateWithSHA256WithRSA = (body, requestSignature, publicKey) => {
	try {
		return { isValid: crypto
				.verify(
					'RSA-SHA256',
					Buffer.from(body),
					{
						key: publicKey,
						padding: crypto.constants.RSA_PKCS1_PADDING
					},
					Buffer.from(requestSignature, 'base64')
				)
		}
	} catch (e) {
		return { isValid: false }
	}
}

module.exports = { handler }