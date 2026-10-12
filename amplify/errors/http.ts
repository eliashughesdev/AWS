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
