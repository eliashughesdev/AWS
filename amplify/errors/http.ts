import { response } from '../utils/http'

const httpErrors: any = {
  100001: () => 'this account id does not exist or not active',
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
}

export const processError = (code: any, params?: any) => {
  return response({
    statusCode: 400,
    headers: null,
    bodyObject: {
      error_code: code,
      message: httpErrors[code](params)
    }
  })
}
