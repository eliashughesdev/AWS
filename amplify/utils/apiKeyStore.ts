// Where API keys live (docs/public-api-plan.md D2.1). Kept free of imports so backend.ts can use
// it at synth time.
//
// A key is a row in API_KEYS_TABLE (no secret, no hash) and the SHA-256 of its secret, hex, as an
// SSM SecureString at apiKeyParameterName(keyId) under the KMS key API_KEY_KMS_ALIAS. Only
// apiKeyIssuerFn writes or deletes that parameter, and only the authorizer may decrypt it.
// The prefix must stay outside the config loader's /loudibly/api/ (utils/config.ts), which reads
// everything under it with decryption.

export const API_KEY_PARAMETER_PREFIX = '/loudibly/api-keys/'
export const API_KEY_KMS_ALIAS = 'alias/loudibly-api-keys'
export const API_KEY_ISSUER_FN = 'apiKeyIssuerFn'

export const API_KEYS_TABLE = 'v1ApiKeysTable'
// Its GSI: a user's or merchant's keys, oldest first
export const API_KEYS_BY_OWNER = 'byOwner'
// One row per key per second, `<keyId>#<epochSecond>`, counted by the authorizer (D2.5)
export const API_KEY_USAGE_TABLE = 'v1ApiKeyUsageTable'

export const apiKeyParameterName = (keyId: string) => `${API_KEY_PARAMETER_PREFIX}${keyId}`
