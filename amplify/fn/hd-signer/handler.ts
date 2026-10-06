import { CreateKeyCommand, KMSClient } from '@aws-sdk/client-kms'
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { putItem, queryItemFromIndex, queryRecord, updateItem } from '../../utils/db'
import { networkFor, NETWORKS, type Network } from '../../utils/currencies'
import { SYSTEM_MERCHANT_ID } from '../../utils/merchant'
import { hdAddress, hdSignSol, hdSignTron, newRecoveryPhrase, seedFromRecoveryPhrase } from '../../utils/hdWallet'

/**
 * Derived (HD) wallets: the only code that ever sees a seed.
 *
 * One seed per merchant per network. Each seed is a recovery phrase kept as an
 * SSM SecureString under its merchant's KMS key (one per merchant, shared by
 * its networks), whose policy lets only this function's role decrypt.
 * v1MerchantTable holds a `SEEDKEY` row per merchant (key id) and a
 * `SEED#<network>` row per seed (key id, parameter name, next index, status),
 * and no secret material.
 *
 * Two Lambdas run this handler, each serving only the operations listed in
 * HD_OPERATIONS: one hands out seeds and addresses, the other signs. That
 * keeps signing out of reach of whoever is only allowed to ask for addresses.
 *
 * Nothing here takes a derivation index or a key reference from the caller,
 * and nothing logs more than ids and the outcome.
 */

const kms = new KMSClient({})
const ssm = new SSMClient({})

const MERCHANT_TABLE = 'v1MerchantTable'
// Outside /loudibly/api/, which the config loader reads with decryption
const SEED_PATH = '/loudibly/hd-seed'

// Longer than the Lambda can run, so an attempt this old is certainly dead
const IN_FLIGHT_MS = 60_000
// How long a request waits for another one creating the merchant's key
const KEY_WAIT_MS = 5_000

const SEED_KEY_SK = 'SEEDKEY'
const seedSk = (network: Network) => `SEED#${network}`
const seedParameter = (merchantId: string, network: Network) => `${SEED_PATH}/${merchantId}/${network}`

// Consistent reads: a merchant or seed written a moment ago must be seen
const loadRow = async (merchantId: string, sk: string) => {
  const result = await queryRecord(MERCHANT_TABLE, 'id = :id AND sk = :sk', { ':id': merchantId, ':sk': sk }, true)
  if (!result.success) throw new Error(`Failed to read ${sk} for merchant ${merchantId}`)
  return result.res?.[0] ?? null
}

const inFlight = (row: Record<string, any>) => Date.now() - Date.parse(row.createdAt) < IN_FLIGHT_MS

// Saves a finished step on a SEEDKEY or SEED# row. `onlyIfMissing` makes a racing
// call fail here instead of overwriting what the other one created.
const saveStep = async (merchantId: string, sk: string, values: Record<string, any>, onlyIfMissing?: string) => {
  const keys = Object.keys(values)
  const result = await updateItem({
    tableName: MERCHANT_TABLE,
    key: { id: merchantId, sk },
    updateExpression: 'SET ' + keys.map(k => `#${k} = :${k}`).join(', '),
    conditionExpression: onlyIfMissing ? `attribute_not_exists(#${onlyIfMissing})` : undefined,
    attributeNames: Object.fromEntries(keys.map(k => [`#${k}`, k])),
    attributeValues: Object.fromEntries(keys.map(k => [`:${k}`, values[k]])),
  })
  if (!result.success) {
    throw new Error(`Failed to save ${keys.join(', ')} on ${sk} for ${merchantId}: ${JSON.stringify(values)} may be orphaned`, { cause: result.error })
  }
}

// The account administers the key through IAM; only this role may use it, and
// nobody else may decrypt with it whatever their IAM policy says.
const seedKeyPolicy = () => {
  const signerRole = process.env.HD_SIGNER_ROLE_ARN!
  const account = signerRole.split(':')[4]
  return {
    Version: '2012-10-17',
    Statement: [
      { Sid: 'AccountAdministers', Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${account}:root` }, Action: 'kms:*', Resource: '*' },
      { Sid: 'SignerUses', Effect: 'Allow', Principal: { AWS: signerRole }, Action: ['kms:Encrypt', 'kms:Decrypt', 'kms:GenerateDataKey', 'kms:DescribeKey'], Resource: '*' },
      { Sid: 'OnlySignerDecrypts', Effect: 'Deny', Principal: '*', Action: 'kms:Decrypt', Resource: '*', Condition: { ArnNotEquals: { 'aws:PrincipalArn': signerRole } } },
    ],
  }
}

const createSeedKey = async (merchantId: string): Promise<string> => {
  const result = await kms.send(new CreateKeyCommand({
    KeySpec: 'SYMMETRIC_DEFAULT',
    KeyUsage: 'ENCRYPT_DECRYPT',
    Description: `HD seed key for merchant ${merchantId}`,
    Policy: JSON.stringify(seedKeyPolicy()),
    // This role can't change key policies, which is the point; the account still can
    BypassPolicyLockoutSafetyCheck: true,
    Tags: [
      { TagKey: 'purpose', TagValue: 'hd-seed' },
      { TagKey: 'merchantId', TagValue: merchantId },
    ],
  }))
  const kmsKeyId = result.KeyMetadata?.KeyId
  if (!kmsKeyId) throw new Error('KMS CreateKey did not return a KeyId')
  return kmsKeyId
}

/**
 * The merchant's seed key, created by whichever request claims the SEEDKEY row
 * first. A request that loses the claim waits for that key rather than create
 * a second one, since registration creates every network's seed at once.
 */
const merchantSeedKey = async (merchantId: string): Promise<string> => {
  const claim = await putItem(MERCHANT_TABLE, { id: merchantId, sk: SEED_KEY_SK, createdAt: new Date().toISOString() }, 'attribute_not_exists(sk)')
  if (!claim.success) {
    if (claim.error?.name !== 'ConditionalCheckFailedException') throw new Error(`Failed to claim ${SEED_KEY_SK} for ${merchantId}`, { cause: claim.error })
    const deadline = Date.now() + KEY_WAIT_MS
    let row = await loadRow(merchantId, SEED_KEY_SK)
    while (row && !row.kmsKeyId && inFlight(row) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250))
      row = await loadRow(merchantId, SEED_KEY_SK)
    }
    if (row?.kmsKeyId) return row.kmsKeyId
    if (!row || inFlight(row)) throw new Error(`${SEED_KEY_SK} for ${merchantId} is being created by another request — retry in a minute`)
  }

  const kmsKeyId = await createSeedKey(merchantId)
  await saveStep(merchantId, SEED_KEY_SK, { kmsKeyId }, 'kmsKeyId')
  return kmsKeyId
}

/**
 * Creates a merchant's seed for one network. Resumable: each finished step is
 * saved, so a retry never creates a second key, and an existing parameter is
 * never overwritten.
 */
const createSeed = async (merchantId: string, network: Network) => {
  if (merchantId !== SYSTEM_MERCHANT_ID && !(await loadRow(merchantId, 'PROFILE'))) throw new Error(`Unknown merchant ${merchantId}`)

  const claimed = { id: merchantId, sk: seedSk(network), network, status: 'provisioning', nextIndex: 0, createdAt: new Date().toISOString() }
  const claim = await putItem(MERCHANT_TABLE, claimed, 'attribute_not_exists(sk)')

  let row: Record<string, any> | null = claimed
  if (!claim.success) {
    if (claim.error?.name !== 'ConditionalCheckFailedException') throw new Error(`Failed to claim ${claimed.sk} for ${merchantId}`, { cause: claim.error })
    row = await loadRow(merchantId, claimed.sk)
    if (!row) throw new Error(`${claimed.sk} for ${merchantId} is being provisioned by another request — retry`)
    // Joining an attempt that is still running would create a second key
    if (row.status !== 'ready' && inFlight(row)) {
      throw new Error(`${claimed.sk} for ${merchantId} is being created by another request — retry in a minute`)
    }
  }
  if (row.status === 'ready') return { status: 'ready', created: false }

  if (!row.kmsKeyId) {
    const kmsKeyId = await merchantSeedKey(merchantId)
    await saveStep(merchantId, seedSk(network), { kmsKeyId }, 'kmsKeyId')
    row = { ...row, kmsKeyId }
  }

  if (!row.parameterName) {
    const parameterName = seedParameter(merchantId, network)
    try {
      await ssm.send(new PutParameterCommand({
        Name: parameterName,
        Type: 'SecureString',
        KeyId: row.kmsKeyId,
        Value: newRecoveryPhrase(),
        Overwrite: false,
      }))
    } catch (err: any) {
      // Stored by an earlier attempt that died before saving the step: keep that seed
      if (err.name !== 'ParameterAlreadyExists') throw new Error(`Failed to store the seed: ${err.name}`)
    }
    await saveStep(merchantId, seedSk(network), { parameterName })
  }

  await saveStep(merchantId, seedSk(network), { status: 'ready' })
  return { status: 'ready', created: true }
}

// The caller wipes the returned seed
const loadSeed = async (merchantId: string, network: Network): Promise<Uint8Array> => {
  const row = await loadRow(merchantId, seedSk(network))
  if (row?.status !== 'ready') throw new Error(`No ready ${network} seed for merchant ${merchantId}`)
  const result = await ssm.send(new GetParameterCommand({ Name: row.parameterName, WithDecryption: true }))
  if (!result.Parameter?.Value) throw new Error(`Seed parameter for ${merchantId} on ${network} is empty`)
  return seedFromRecoveryPhrase(result.Parameter.Value)
}

/** Hands out the next index under a merchant's seed. An index is never reused. */
const allocateAddress = async (merchantId: string, network: Network) => {
  // Loaded first, so a seed that can't be read doesn't use up an index
  const seed = await loadSeed(merchantId, network)
  try {
    const updated = await updateItem({
      tableName: MERCHANT_TABLE,
      key: { id: merchantId, sk: seedSk(network) },
      updateExpression: 'ADD #next :one',
      conditionExpression: '#status = :ready',
      attributeNames: { '#next': 'nextIndex', '#status': 'status' },
      attributeValues: { ':one': 1, ':ready': 'ready' },
      returnValues: 'UPDATED_NEW',
    })
    if (!updated.success || !updated.res?.Attributes) throw new Error(`Failed to allocate an index for ${merchantId} on ${network}`)

    const derivationIndex = unmarshall(updated.res.Attributes).nextIndex - 1
    return { derivationIndex, address: hdAddress(seed, network, derivationIndex) }
  } finally {
    seed.fill(0)
  }
}

type Owner = { accountNo?: string, merchantId?: string, currency?: string }

// The stored record of whoever is signing: a customer account, or a merchant's master
const loadOwner = async (owner: Owner) => {
  if (owner.accountNo) {
    const lookup = await queryItemFromIndex({
      tableName: 'v2CustomerTable',
      indexName: 'v1v2CustomerTableToAccountId',
      keyConditionExpression: '#sk = :sk',
      attributeNames: { '#sk': 'sk' },
      attributeValues: { ':sk': `ACCOUNT#${owner.accountNo}` },
    })
    if (!lookup.success) throw new Error(`Failed to read account ${owner.accountNo}`)
    const account = lookup.res?.[0]
    return account ? { record: account, merchantId: account.merchantId ?? SYSTEM_MERCHANT_ID, currency: account.chain } : null
  }
  if (owner.merchantId && owner.currency) {
    const master = await loadRow(owner.merchantId, `MASTER#${owner.currency.toUpperCase()}`)
    return master ? { record: master, merchantId: owner.merchantId, currency: master.currency } : null
  }
  throw new Error('owner needs an accountNo, or a merchantId and currency')
}

/**
 * Signs for a stored account or master. The merchant, network and index come
 * from its record. TRON takes the transaction's `raw_data_hex`; Solana takes
 * the serialized message in base64.
 */
const sign = async (owner: Owner, payload: { rawDataHex?: string, messageBase64?: string }) => {
  const found = await loadOwner(owner)
  if (!found) throw new Error('No such account')

  const { record, merchantId } = found
  const network = networkFor(found.currency)
  if (record.keyModel !== 'hd' || !Number.isInteger(record.derivationIndex) || !network) throw new Error('Not a derived-wallet account')

  const seed = await loadSeed(merchantId, network)
  try {
    if (hdAddress(seed, network, record.derivationIndex) !== record.depositAddress) {
      throw new Error('The stored address does not belong to the stored index')
    }
    if (network === 'TRON') {
      if (!payload.rawDataHex || !/^([0-9a-f]{2})+$/i.test(payload.rawDataHex)) throw new Error('rawDataHex must be the transaction as hex')
      return hdSignTron(seed, record.derivationIndex, payload.rawDataHex)
    }
    if (!payload.messageBase64) throw new Error('messageBase64 is required')
    return { signature: hdSignSol(seed, record.derivationIndex, Buffer.from(payload.messageBase64, 'base64')) }
  } finally {
    seed.fill(0)
  }
}

const MERCHANT_ID = /^[A-Za-z0-9_.-]+$/

const seedTarget = (event: any): [string, Network] => {
  if (typeof event.merchantId !== 'string' || !MERCHANT_ID.test(event.merchantId)) throw new Error('Invalid merchantId')
  if (!NETWORKS.includes(event.network)) throw new Error('network must be TRON or SOL')
  return [event.merchantId, event.network]
}

const operations: Record<string, (event: any) => Promise<Record<string, any>>> = {
  createSeed: event => createSeed(...seedTarget(event)),
  allocateAddress: event => allocateAddress(...seedTarget(event)),
  sign: event => sign(event.owner ?? {}, event),
}

export const handler = async (event: any) => {
  const op = String(event?.op)
  const who = event?.owner ? JSON.stringify(event.owner) : `${event?.merchantId}/${event?.network}`

  const served = (process.env.HD_OPERATIONS ?? '').split(',')
  if (!served.includes(op) || !operations[op]) throw new Error(`Operation not served here: ${op}`)

  try {
    const result = await operations[op](event)
    console.log(`HD_SIGNER: ${op} ok for ${who}`)
    return result
  } catch (err: any) {
    console.error(`HD_SIGNER: ${op} failed for ${who}: ${err.message}`)
    throw err
  }
}
