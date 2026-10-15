/**
 * apiKeyIssuerFn: the only code that writes or deletes an API key's hash (docs/public-api-plan.md
 * D2.1, D2.2). It runs under ApiKeyIssuerRole, which may put and delete parameters under
 * /loudibly/api-keys/, encrypt with the API keys' KMS key and write v1ApiKeysTable, and nothing
 * else. Only mainApiFn may invoke it.
 *
 * `create` and `revoke` come in step 2.2; until then every operation is refused.
 */

export type IssuerRequest = { operation?: string }
export type IssuerResponse = { ok: false, error: string }

export const handler = async (event: IssuerRequest): Promise<IssuerResponse> => {
  console.log(`API_KEY_ISSUER: refused operation ${JSON.stringify(event?.operation ?? null)}`)
  return { ok: false, error: 'unknown operation' }
}
