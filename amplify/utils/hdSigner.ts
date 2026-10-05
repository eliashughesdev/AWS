import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import type { Network } from './currencies'

// Callers of the derived-wallet Lambdas (amplify/fn/hd-signer). The function
// names are the ones set in backend.ts; each caller's role may invoke only the
// one it needs.
const ADDRESS_FUNCTION = 'hdAddressFn'
const SIGNER_FUNCTION = 'hdSignerFn'

// Who a signature is for: a customer account, or a merchant's master for a currency
export type SeedOwner = { accountNo: string } | { merchantId: string, currency: string }

const lambda = new LambdaClient({})

const invoke = async <T>(functionName: string, payload: Record<string, any>): Promise<T> => {
  const result = await lambda.send(new InvokeCommand({
    FunctionName: functionName,
    Payload: Buffer.from(JSON.stringify(payload)),
  }))
  const body = result.Payload?.length ? JSON.parse(Buffer.from(result.Payload).toString()) : null
  if (result.FunctionError) throw new Error(`${functionName} ${payload.op} failed: ${body?.errorMessage ?? result.FunctionError}`)
  return body
}

/** Creates a merchant's seed for a network, or finishes one left half-created. */
export const createSeed = (merchantId: string, network: Network) =>
  invoke<{ status: string, created: boolean }>(ADDRESS_FUNCTION, { op: 'createSeed', merchantId, network })

/** The next unused address under a merchant's seed. Fails when the merchant has no ready seed. */
export const allocateAddress = (merchantId: string, network: Network) =>
  invoke<{ derivationIndex: number, address: string }>(ADDRESS_FUNCTION, { op: 'allocateAddress', merchantId, network })

/**
 * Signs for a derived account or master. TRON takes the transaction's
 * `raw_data_hex` and gets back the txId the signer computed; Solana takes the
 * serialized message in base64.
 */
export const signWithSeed = (owner: SeedOwner, payload: { rawDataHex: string } | { messageBase64: string }) =>
  invoke<{ signature: string, txId?: string }>(SIGNER_FUNCTION, { op: 'sign', owner, ...payload })
