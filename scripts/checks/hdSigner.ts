// Runs the signer's handler against in-memory stand-ins for DynamoDB, KMS and
// SSM, so its logic can be checked without a deployed stack. Exits 1 on any
// mismatch. Run:
//
//   npx tsx scripts/checks/hdSigner.ts

import crypto from 'crypto'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { KMSClient } from '@aws-sdk/client-kms'
import { SSMClient } from '@aws-sdk/client-ssm'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { Keypair } from '@solana/web3.js'
import { hdAddress, hdSignTron, seedFromRecoveryPhrase, slip10Ed25519 } from '../../amplify/utils/hdWallet'

const ROLE = 'arn:aws:iam::111122223333:role/hd-signer'
process.env.HD_SIGNER_ROLE_ARN = ROLE

// ---- stand-ins -------------------------------------------------------------

const tables: Record<string, Map<string, any>> = {}
const table = (name: string) => (tables[name] ??= new Map())
const keyOf = (item: any) => `${item.id}|${item.sk ?? ''}`
const named = (name: string) => Object.assign(new Error(name), { name })
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

const keys: { id: string, policy: any, tags: any[] }[] = []
;(KMSClient.prototype as any).send = async (command: any) => {
  if (command.constructor.name !== 'CreateKeyCommand') throw new Error(`stand-in: unsupported command ${command.constructor.name}`)
  const id = `key-${keys.length + 1}`
  keys.push({ id, policy: JSON.parse(command.input.Policy), tags: command.input.Tags })
  return { KeyMetadata: { KeyId: id } }
}

const parameters = new Map<string, { value: string, keyId: string, type: string }>()
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

// ---- checks ----------------------------------------------------------------

const { handler } = await import('../../amplify/fn/hd-signer/handler')

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failed++
}
const rejects = async (promise: Promise<unknown>) => promise.then(() => false, () => true)
const as = (operations: string) => { process.env.HD_OPERATIONS = operations }
const merchants = table('v1MerchantTable')
const accounts = table('v2CustomerTable')
const seedRow = (merchantId: string, network: string) => merchants.get(`${merchantId}|SEED#${network}`)
const seedOf = (merchantId: string, network: string) => seedFromRecoveryPhrase(parameters.get(`/loudibly/hd-seed/${merchantId}/${network}`)!.value)

merchants.set('acme|PROFILE', { id: 'acme', sk: 'PROFILE', status: 'active' })

// 1. Creating a seed
as('createSeed,allocateAddress')
const first = await handler({ op: 'createSeed', merchantId: 'acme', network: 'TRON' })
const stored = parameters.get('/loudibly/hd-seed/acme/TRON')
check('createSeed reports a new seed', first.status === 'ready' && first.created === true)
check('one KMS key was created for it', keys.length === 1 && seedRow('acme', 'TRON').kmsKeyId === 'key-1')
check('the seed is a 24-word SecureString under that key', stored?.type === 'SecureString' && stored.keyId === 'key-1' && stored.value.split(' ').length === 24)
check('the SEED# row is ready and starts at index 0', seedRow('acme', 'TRON').status === 'ready' && seedRow('acme', 'TRON').nextIndex === 0)
check('the SEED# row holds no word of the phrase', !stored!.value.split(' ').some(word => word.length > 4 && JSON.stringify(seedRow('acme', 'TRON')).includes(word)))

const deny = keys[0].policy.Statement.find((s: any) => s.Effect === 'Deny')
check('the key policy denies decrypt to everyone but the signer role', deny?.Action === 'kms:Decrypt' && deny.Principal === '*' && deny.Condition.ArnNotEquals['aws:PrincipalArn'] === ROLE)
check('the key is tagged purpose=hd-seed, not service=loudibly', keys[0].tags.some(t => t.TagKey === 'purpose' && t.TagValue === 'hd-seed') && !keys[0].tags.some(t => t.TagKey === 'service'))

// 2. Creating it again changes nothing
const again = await handler({ op: 'createSeed', merchantId: 'acme', network: 'TRON' })
check('createSeed again reports the existing seed', again.created === false)
check('no second key and the same phrase', keys.length === 1 && parameters.get('/loudibly/hd-seed/acme/TRON')!.value === stored!.value)

// 3. Resuming an attempt that stored the phrase but died before saving the step
merchants.set('acme|SEED#SOL', { id: 'acme', sk: 'SEED#SOL', network: 'SOL', status: 'provisioning', nextIndex: 0, kmsKeyId: 'key-earlier' })
parameters.set('/loudibly/hd-seed/acme/SOL', { value: stored!.value, keyId: 'key-earlier', type: 'SecureString' })
await handler({ op: 'createSeed', merchantId: 'acme', network: 'SOL' })
check('a resumed createSeed finishes', seedRow('acme', 'SOL').status === 'ready')
check('a resumed createSeed keeps the stored phrase and creates no key', parameters.get('/loudibly/hd-seed/acme/SOL')!.value === stored!.value && keys.length === 1)

// 4. Who may have a seed
check('an unknown merchant is refused', await rejects(handler({ op: 'createSeed', merchantId: 'nobody', network: 'TRON' })))
check('a merchant id with a path in it is refused', await rejects(handler({ op: 'createSeed', merchantId: 'acme/../x', network: 'TRON' })))
check('an unknown network is refused', await rejects(handler({ op: 'createSeed', merchantId: 'acme', network: 'BTC' })))
await handler({ op: 'createSeed', merchantId: 'loudibly', network: 'TRON' })
check('the system merchant gets a seed without a PROFILE row', seedRow('loudibly', 'TRON').status === 'ready')
check('two merchants have different seeds and keys', parameters.get('/loudibly/hd-seed/loudibly/TRON')!.value !== stored!.value && seedRow('loudibly', 'TRON').kmsKeyId !== 'key-1')

// 5. Handing out addresses
const handed = []
for (let i = 0; i < 3; i++) handed.push(await handler({ op: 'allocateAddress', merchantId: 'acme', network: 'TRON' }))
check('indexes are handed out in order from 0', handed.map(h => h.derivationIndex).join() === '0,1,2')
check('each address is the one at its index under the stored seed', handed.every(h => h.address === hdAddress(seedOf('acme', 'TRON'), 'TRON', h.derivationIndex)))
check('the addresses differ', new Set(handed.map(h => h.address)).size === 3)
check('a merchant with no seed gets no address', await rejects(handler({ op: 'allocateAddress', merchantId: 'acme2', network: 'TRON' })))
check('…and no row is created for it', seedRow('acme2', 'TRON') === undefined)

// 6. Signing
as('sign')
accounts.set('user-1|ACCOUNT#acc-1', { id: 'user-1', sk: 'ACCOUNT#acc-1', merchantId: 'acme', chain: 'TUSDT_TRON', keyModel: 'hd', derivationIndex: 1, depositAddress: handed[1].address })
const rawDataHex = crypto.randomBytes(100).toString('hex')
const signed = await handler({ op: 'sign', owner: { accountNo: 'acc-1' }, rawDataHex })
const expected = hdSignTron(seedOf('acme', 'TRON'), 1, rawDataHex)
check('a TRON account signs with the key at its stored index', signed.signature === expected.signature && signed.txId === expected.txId)

accounts.set('user-1|ACCOUNT#acc-2', { id: 'user-1', sk: 'ACCOUNT#acc-2', merchantId: 'acme', chain: 'TRON', keyModel: 'hd', derivationIndex: 2, depositAddress: handed[1].address })
check('an index that does not match the stored address is refused', await rejects(handler({ op: 'sign', owner: { accountNo: 'acc-2' }, rawDataHex })))

accounts.set('user-1|ACCOUNT#acc-3', { id: 'user-1', sk: 'ACCOUNT#acc-3', merchantId: 'acme', chain: 'TRON', kmsKeyId: 'some-kms-key', depositAddress: handed[0].address })
check('a KMS-model account is refused', await rejects(handler({ op: 'sign', owner: { accountNo: 'acc-3' }, rawDataHex })))
check('an unknown account is refused', await rejects(handler({ op: 'sign', owner: { accountNo: 'nope' }, rawDataHex })))
check('a TRON payload that is not hex is refused', await rejects(handler({ op: 'sign', owner: { accountNo: 'acc-1' }, rawDataHex: 'zz' })))

merchants.set('acme|MASTER#TUSDT_TRON', { id: 'acme', sk: 'MASTER#TUSDT_TRON', currency: 'TUSDT_TRON', status: 'ready', keyModel: 'hd', derivationIndex: 0, depositAddress: handed[0].address })
const byMaster = await handler({ op: 'sign', owner: { merchantId: 'acme', currency: 'tusdt_tron' }, rawDataHex })
check('a merchant master signs with its own index', byMaster.signature === hdSignTron(seedOf('acme', 'TRON'), 0, rawDataHex).signature)

as('createSeed,allocateAddress')
const sol = await handler({ op: 'allocateAddress', merchantId: 'acme', network: 'SOL' })
as('sign')
accounts.set('user-2|ACCOUNT#acc-4', { id: 'user-2', sk: 'ACCOUNT#acc-4', merchantId: 'acme', chain: 'SOL', keyModel: 'hd', derivationIndex: sol.derivationIndex, depositAddress: sol.address })
const message = crypto.randomBytes(150)
const solSigned = await handler({ op: 'sign', owner: { accountNo: 'acc-4' }, messageBase64: message.toString('base64') })
const solPublicKey = crypto.createPublicKey({
  key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Keypair.fromSeed(slip10Ed25519(seedOf('acme', 'SOL'), [44, 501, sol.derivationIndex, 0])).publicKey.toBytes()]),
  format: 'der',
  type: 'spki',
})
check('a Solana account signs a message that verifies', crypto.verify(null, message, solPublicKey, Buffer.from(solSigned.signature, 'hex')))

// 7. Each function serves only its own operations
check('the signing function refuses to hand out addresses', await rejects(handler({ op: 'allocateAddress', merchantId: 'acme', network: 'TRON' })))
check('the signing function refuses to create seeds', await rejects(handler({ op: 'createSeed', merchantId: 'acme', network: 'TRON' })))
as('createSeed,allocateAddress')
check('the address function refuses to sign', await rejects(handler({ op: 'sign', owner: { accountNo: 'acc-1' }, rawDataHex })))
check('an unknown operation is refused', await rejects(handler({ op: 'constructor' })))

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
