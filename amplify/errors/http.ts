import { response } from '../utils/http'

const httpErrors: any = {
  100001: () => 'this account id does not exist or not active',
  100002: (params: any) => params ?? 'internal error while processing the request',
  100003: () => 'failed to persist the required records',
  100005: () => 'this account does not belong to the provided user',
  100006: () => 'currency does not match account currency',
  100007: () => 'insufficient balance for this withdrawal',
  100008: () => 'destination address required for crypto withdrawal',
  100009: () => 'this currency is not supported for this operation',
  100029: (params: any) => `required parameters for this request are ${params}`,
  100031: (params: any) => `invalid value for ${params}`,
  100032: () => 'this email is already registered to a different user',
  100033: () => 'this transaction has already been processed',
  100034: () => 'this link is not valid',
  100035: () => 'this link has expired',
  100036: () => 'this link has already been used',
  100037: (params: any) => params ?? 'the password does not meet the requirements',
  100038: () => 'no pending invite found for this payer',
  100039: () => 'this payer has already set a password — use password reset instead',
  100040: () => 'this merchant does not exist or is not active',
  100041: () => 'provisioning this currency did not complete — retry the request',
  100042: () => 'you are not a member of any merchant',
  100043: () => 'your merchant role does not allow this action',
  100044: () => 'there is no treasury policy for this currency',
  100045: () => 'treasury sends are not available for this currency',
  100046: () => 'the fee balance does not cover this treasury send',
  100047: () => 'there are not enough approvers for this request',
  100048: () => 'invalid destination address',
  100049: () => 'this user is not an active member of this merchant',
  100050: (params: any) => `this merchant is not set up for ${params} yet — its master must be provisioned first`,
  100051: () => 'the sender and the recipient are the same account',
  100052: (params: any) => `the recipient account does not hold ${params}`,
  100053: () => 'this user is not yours to act for',
  100054: (params: any) => `this owner already has ${params ?? 10} active API keys; revoke one first`,
  100055: (params: any) => params ? `this API key does not have the ${params} permission` : 'this endpoint cannot be called with an API key',
  100056: () => 'too many requests for this API key; retry after the number of seconds in Retry-After',
  100057: () => 'API keys are managed from a signed-in session',
  100058: (params: any) => `unknown permission: ${params}`,
  // 100054–100058 are planned for API keys (docs/public-api-plan.md D2.6)
  // params names the operations and currency, e.g. 'withdrawals in USDT_TRON' (utils/kycPolicy.ts)
  100059: (params: any) => params ? `${params} need a verified identity` : 'this operation needs a verified identity',
  100060: () => 'this API key does not exist',
  // 409, from utils/idempotency.ts
  100061: (params: any) => params === 'running'
    ? 'a request with this Idempotency-Key has not finished; check its result before sending it again with a new key'
    : 'this Idempotency-Key was already used for a different request',
  // An API key's IP allowlist: single IPv4 or IPv6 addresses, at most 20 (D2.3)
  100062: (params: any) => params === 'too-many' ? 'an API key takes at most 20 IP addresses' : `not a valid IP address: ${params}`,
}

// statusCode is 400 unless the code needs another, as 100053's 403 does
export const processError = (code: any, params?: any, statusCode = 400) => {
  return response({
    statusCode,
    headers: null,
    bodyObject: {
      error_code: code,
      message: httpErrors[code](params)
    }
  })
}
