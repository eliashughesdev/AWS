import { API_KEY_PARAMETER_PREFIX, apiKeyParameterName } from './apiKeyStore'
import { SSM_PATH } from './config'

// SSM paths are split on '/': '/loudibly/api/' does not hold '/loudibly/api-keys/x'
const under = (name: string, path: string) => name.startsWith(path.endsWith('/') ? path : `${path}/`)

describe('apiKeyStore', () => {
  // The config loader reads everything under its path with decryption, into process.env of
  // mainApiFn, which must never see a key's hash (D2.1). Decryption would also be refused by the
  // key's policy and fail every config load
  it('keeps key hashes outside the config loader\'s path', () => {
    expect(under(apiKeyParameterName('key_1'), SSM_PATH)).toBe(false)
    expect(under(apiKeyParameterName('key_1'), API_KEY_PARAMETER_PREFIX)).toBe(true)
  })
})
