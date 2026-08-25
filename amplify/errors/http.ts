import { response } from '../utils/http'

const httpErrors: any = {
  100001: () => 'this account id does not exist or not active',
  100005: () => 'this account does not belong to the provided user',
  100006: () => 'currency does not match account currency',
  100007: () => 'insufficient balance for this withdrawal',
  100008: () => 'destination address required for crypto withdrawal',
  100009: () => 'this currency is not supported for this operation',
  100029: (params: any) => `required parameters for this request are ${params}`,
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
