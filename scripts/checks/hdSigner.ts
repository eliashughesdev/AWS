// Runs the signer's handler against in-memory stand-ins for DynamoDB, KMS and
// SSM, so its logic can be checked without a deployed stack. Exits 1 on any
// mismatch. Run:
//
//   npx tsx scripts/checks/hdSigner.ts

import crypto from 'crypto'
import { Keypair } from '@solana/web3.js'
import { hdAddress, hdSignTron, seedFromRecoveryPhrase, slip10Ed25519 } from '../../amplify/utils/hdWallet'
import { check, finish, kmsKeys as keys, parameters, rejects, SIGNER_ROLE as ROLE, table } from './standIns'

const { handler } = await import('../../amplify/fn/hd-signer/handler')

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

// A creation that is still running is not joined
merchants.set('busy|PROFILE', { id: 'busy', sk: 'PROFILE', status: 'active' })
merchants.set('busy|SEED#TRON', { id: 'busy', sk: 'SEED#TRON', network: 'TRON', status: 'provisioning', nextIndex: 0, createdAt: new Date().toISOString() })
check('a seed another request is creating right now is not joined', await rejects(handler({ op: 'createSeed', merchantId: 'busy', network: 'TRON' })) && keys.length === 1)

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

finish()
