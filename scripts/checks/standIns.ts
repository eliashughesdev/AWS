// In-memory stand-ins for what the derived-wallet code talks to (DynamoDB, KMS,
// SSM, the Lambda that runs the signer, and Tatum's account calls), plus the
// helpers the checks share. Importing this file installs them.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { KMSClient } from '@aws-sdk/client-kms'
import { LambdaClient } from '@aws-sdk/client-lambda'
import { SSMClient } from '@aws-sdk/client-ssm'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { TatumProvider } from '../../amplify/providers/ledger/tatum/tatum'

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
      // Key conditions joined by AND: `attr = :v`, `#alias = :v`, `begins_with(attr, :v)`
      const tests = (input.KeyConditionExpression as string).split(' AND ').map(part => {
        const prefix = part.match(/^begins_with\((#?\w+), (:\w+)\)$/)
        const equals = part.match(/^(#?\w+) = (:\w+)$/)
        if (!prefix && !equals) throw new Error(`stand-in: unsupported key condition ${part}`)
        const [, attribute, value] = (prefix ?? equals)!
        const name = names[attribute] ?? attribute
        return (row: any) => prefix ? String(row[name] ?? '').startsWith(values[value]) : row[name] === values[value]
      })
      return { Items: [...rows.values()].filter(row => tests.every(test => test(row))).map(wire) }
    }
    case 'UpdateItemCommand': {
      const key = unmarshall(input.Key)
      const row = rows.get(keyOf(key))
      const condition: string | undefined = input.ConditionExpression
      if (condition) {
        const missing = condition.match(/^attribute_not_exists\((#\w+)\)$/)
        const equals = condition.match(/^(#\w+) = (:\w+)$/)
        // settleOperation's: only a record that exists and is still pending (utils/operations.ts)
        const operation = condition.startsWith('attribute_exists(id) AND ')
        if (operation) {
          if (!row || !['pending', 'requires_action'].includes(row.status)) throw named('ConditionalCheckFailedException')
        } else if (!missing && !equals) throw new Error(`stand-in: unsupported condition ${condition}`)
        if (missing && row?.[names[missing[1]]] !== undefined) throw named('ConditionalCheckFailedException')
        if (equals && row?.[names[equals[1]]] !== values[equals[2]]) throw named('ConditionalCheckFailedException')
      }
      const next = { ...(row ?? key) }
      const update: string = input.UpdateExpression
      if (update.startsWith('SET ')) {
        for (const part of update.slice(4).split(', ')) {
          const [name, value] = part.split(' = ')
          // `#a = #a + :v` / `#a = #a - :v`, as a balance is moved
          const relative = value.match(/^(#\w+) ([+-]) (:\w+)$/)
          next[names[name]] = relative
            ? (next[names[relative[1]]] ?? 0) + (relative[2] === '+' ? 1 : -1) * values[relative[3]]
            : values[value]
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

export const kmsKeys: { id: string, usage: string, policy: any, tags: any[] }[] = []

;(KMSClient.prototype as any).send = async (command: any) => {
  const input = command.input
  if (command.constructor.name !== 'CreateKeyCommand') throw new Error(`stand-in: unsupported command ${command.constructor.name}`)
  const id = `key-${kmsKeys.length + 1}`
  kmsKeys.push({ id, usage: input.KeyUsage, policy: input.Policy ? JSON.parse(input.Policy) : null, tags: input.Tags ?? [] })
  return { KeyMetadata: { KeyId: id } }
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

// ---- Tatum: the calls provisioning makes -------------------------------------

export const tatum = {
  accounts: [] as string[],
  assigned: [] as string[],
  subscriptions: [] as string[],
  cancelled: [] as string[],
  removed: [] as string[],
  deactivated: [] as string[],
  failSubscription: false,
}

process.env.TATUM_WEBHOOK_URL = 'https://example.test/webhook'

Object.assign(TatumProvider.prototype, {
  createVaAccount: async () => {
    const accountId = `va-${tatum.accounts.length + 1}`
    tatum.accounts.push(accountId)
    return { accountId }
  },
  assignDepositAddress: async ({ address }: { address: string }) => {
    tatum.assigned.push(address)
    return { address }
  },
  createSubscription: async () => {
    if (tatum.failSubscription) throw new Error('Tatum refused the subscription')
    const subscriptionId = `sub-${tatum.subscriptions.length + 1}`
    tatum.subscriptions.push(subscriptionId)
    return { subscriptionId }
  },
  cancelSubscription: async (subscriptionId: string) => { tatum.cancelled.push(subscriptionId) },
  removeDepositAddress: async ({ address }: { address: string }) => { tatum.removed.push(address) },
  deactivateVaAccount: async (accountId: string) => { tatum.deactivated.push(accountId) },
})

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
