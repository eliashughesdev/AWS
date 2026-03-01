import { response } from '../utils/http'

const httpErrors: any = {
  100001: () => 'this account id does not exist or not active',
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
