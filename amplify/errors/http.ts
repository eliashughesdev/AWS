import { response } from '../utils/http'

const httpErrors: any = {
  100001: () => 'this account id does not exist or not active',
  100005: () => 'this account does not belong to the provided user',
  100006: () => 'currency does not match account currency',
  100007: () => 'insufficient balance for this withdrawal',
  100008: () => 'destination address required for crypto withdrawal',
  100029: (params: any) => `required parameters for this request are ${params}`,
  // Card issuance (Ecapz/Card Bridge) — a fresh number range: 100001-100029 already
  // reuses Card Bridge's own numeric codes for unrelated Loudibly meanings, so Card
  // Bridge's raw error codes can't be passed through here without colliding.
  200001: () => 'failed to issue card, please try again',
  200002: () => 'card provider request failed',
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
