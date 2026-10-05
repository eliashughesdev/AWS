// In-memory stand-ins for the AWS services the derived-wallet code talks to
// (DynamoDB, KMS, SSM and the Lambda that runs the signer), plus the helpers
// the checks share. Importing this file installs them.

import crypto from 'crypto'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { KMSClient } from '@aws-sdk/client-kms'
import { LambdaClient } from '@aws-sdk/client-lambda'
import { SSMClient } from '@aws-sdk/client-ssm'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

export const SIGNER_ROLE = 'arn:aws:iam::111122223333:role/hd-signer'
process.env.HD_SIGNER_ROLE_ARN = SIGNER_ROLE

const named = (name: string) => Object.assign(new Error(name), { name })

// ---- DynamoDB --------------------------------------------------------------

const tables: Record<string, Map<string, any>> = {}
export const table = (name: string) => (tables[name] ??= new Map())
const keyOf = (item: any) => `${item.id}|${item.sk ?? ''}`
const wire = (item: any) => marshall(item, { removeUndefinedValues: true })

;(DynamoDBClient.prototype as any).send = async (command: any) => {
  const input = command.input
  const rows = table(input.TableName)
  const values = unmarshall(input.ExpressionAttributeValues ?? {})
  const names = input.ExpressionAttributeNames ?? {}

  switch (command.constructor.name) {
    case 'PutItemCommand': {
      const item = unmarshall(input.Item)
      if (input.ConditionExpression === 'attribute_not_exists(sk)' && rows.has(keyOf(item))) throw named('ConditionalCheckFailedException')
      rows.set(keyOf(item), item)
      return {}
    }
    case 'QueryCommand': {
      const items = [...rows.values()].filter(row => input.IndexName ? row.sk === values[':sk'] : row.id === values[':id'] && row.sk === values[':sk'])
      return { Items: items.map(wire) }
    }
    case 'UpdateItemCommand': {
      const key = unmarshall(input.Key)
      const row = rows.get(keyOf(key))
      const condition: string | undefined = input.ConditionExpression
      if (condition) {
        const missing = condition.match(/^attribute_not_exists\((#\w+)\)$/)
        const equals = condition.match(/^(#\w+) = (:\w+)$/)
        if (!missing && !equals) throw new Error(`stand-in: unsupported condition ${condition}`)
        if (missing && row?.[names[missing[1]]] !== undefined) throw named('ConditionalCheckFailedException')
        if (equals && row?.[names[equals[1]]] !== values[equals[2]]) throw named('ConditionalCheckFailedException')
      }
      const next = { ...(row ?? key) }
      const update: string = input.UpdateExpression
      if (update.startsWith('SET ')) {
        for (const part of update.slice(4).split(', ')) {
          const [name, value] = part.split(' = ')
          next[names[name]] = values[value]
        }
      } else if (update.startsWith('ADD ')) {
        const [name, value] = update.slice(4).split(' ')
        next[names[name]] = (next[names[name]] ?? 0) + values[value]
      } else throw new Error(`stand-in: unsupported update ${update}`)
      rows.set(keyOf(key), next)
      return input.ReturnValues ? { Attributes: wire(next) } : {}
    }
  }
  throw new Error(`stand-in: unsupported command ${command.constructor.name}`)
}

// ---- KMS -------------------------------------------------------------------

export const kmsKeys: { id: string, usage: string, policy: any, tags: any[], publicKey?: Buffer, deletionScheduled?: boolean }[] = []

;(KMSClient.prototype as any).send = async (command: any) => {
  const input = command.input
  const key = kmsKeys.find(k => k.id === input.KeyId)
  switch (command.constructor.name) {
    case 'CreateKeyCommand': {
      const id = `key-${kmsKeys.length + 1}`
      // A per-account signing key needs a public key for its address
      const publicKey = input.KeyUsage !== 'SIGN_VERIFY'
        ? undefined
        : input.KeySpec === 'ECC_SECG_P256K1'
          ? crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).publicKey.export({ type: 'spki', format: 'der' })
          : crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' })
      kmsKeys.push({ id, usage: input.KeyUsage, policy: input.Policy ? JSON.parse(input.Policy) : null, tags: input.Tags ?? [], publicKey })
      return { KeyMetadata: { KeyId: id } }
    }
    case 'GetPublicKeyCommand':
      return { PublicKey: key!.publicKey }
    case 'ScheduleKeyDeletionCommand':
      key!.deletionScheduled = true
      return {}
  }
  throw new Error(`stand-in: unsupported command ${command.constructor.name}`)
}

// ---- SSM -------------------------------------------------------------------

export const parameters = new Map<string, { value: string, keyId: string, type: string }>()

;(SSMClient.prototype as any).send = async (command: any) => {
  const input = command.input
  if (command.constructor.name === 'PutParameterCommand') {
    if (parameters.has(input.Name) && !input.Overwrite) throw named('ParameterAlreadyExists')
    parameters.set(input.Name, { value: input.Value, keyId: input.KeyId, type: input.Type })
    return {}
  }
  if (command.constructor.name === 'GetParameterCommand') {
    const parameter = parameters.get(input.Name)
    if (!parameter) throw named('ParameterNotFound')
    return { Parameter: { Value: parameter.value } }
  }
  throw new Error(`stand-in: unsupported command ${command.constructor.name}`)
}

// ---- Lambda: invoking a signer function runs the real handler ---------------

const OPERATIONS: Record<string, string> = { hdAddressFn: 'createSeed,allocateAddress', hdSignerFn: 'sign' }

;(LambdaClient.prototype as any).send = async (command: any) => {
  const { handler } = await import('../../amplify/fn/hd-signer/handler')
  const { FunctionName, Payload } = command.input
  process.env.HD_OPERATIONS = OPERATIONS[FunctionName] ?? ''
  try {
    const result = await handler(JSON.parse(Buffer.from(Payload).toString()))
    return { Payload: Buffer.from(JSON.stringify(result)) }
  } catch (err: any) {
    return { FunctionError: 'Unhandled', Payload: Buffer.from(JSON.stringify({ errorMessage: err.message })) }
  }
}

// ---- shared by the checks --------------------------------------------------

let failed = 0
export const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failed++
}
export const rejects = async (promise: Promise<unknown>) => promise.then(() => false, () => true)
export const finish = () => {
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
  process.exit(failed ? 1 : 0)
}
