import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { API_KEY_ISSUER_FN } from './apiKeyStore'
import type { CreateRequest, IssuerResponse, RevokeRequest } from '../fn/api-key-issuer/handler'

// The API's way to create and revoke keys (amplify/fn/api-key-issuer). mainApiFn may invoke the
// issuer and nothing else about keys: it cannot read or write a key's hash itself (D2.1).
//
// Both throw when the issuer could not be reached or crashed. For create that does not mean no
// key was made: a caller must not simply send it again, as for /merchants/register.

const lambda = new LambdaClient({})

const invoke = async (payload: CreateRequest | RevokeRequest): Promise<IssuerResponse> => {
  const result = await lambda.send(new InvokeCommand({
    FunctionName: API_KEY_ISSUER_FN,
    Payload: Buffer.from(JSON.stringify(payload)),
  }))
  const body = result.Payload?.length ? JSON.parse(Buffer.from(result.Payload).toString()) : null
  // Never the payload: a create's answer holds the secret
  if (result.FunctionError || !body) throw new Error(`${API_KEY_ISSUER_FN} ${payload.op} failed: ${result.FunctionError ?? 'no answer'}`)
  return body
}

/** A new key and its secret, which nothing keeps: the caller hands it to the browser once. */
export const issueApiKey = (request: Omit<CreateRequest, 'op'>) => invoke({ op: 'create', ...request })

/** Revokes a key; with ownerId, only that owner's. Revoking a revoked key answers ok. */
export const revokeApiKey = (request: Omit<RevokeRequest, 'op'>) => invoke({ op: 'revoke', ...request })
