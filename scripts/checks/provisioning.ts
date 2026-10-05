// Runs account and master provisioning end to end against in-memory stand-ins
// for AWS and Tatum, so the wiring between provisioning and the signer can be
// checked without a deployed stack. Exits 1 on any
// mismatch. Run:
//
//   npx tsx scripts/checks/provisioning.ts

import crypto from 'crypto'
import { check, finish, kmsKeys, parameters, rejects, table, tatum } from './standIns'
import { ProviderName } from '../../amplify/providers/ledger/ProviderName'
import { discardProvisionedAccount, provisionCustodialAccount } from '../../amplify/utils/custodialAccount'
import { provisionMerchantMaster } from '../../amplify/utils/merchantMaster'
import { createSeed } from '../../amplify/utils/hdSigner'
import { hdAddress, hdSignTron, seedFromRecoveryPhrase } from '../../amplify/utils/hdWallet'

const merchants = table('v1MerchantTable')
const accounts = table('v2CustomerTable')
for (const id of ['acme', 'beta', 'gamma']) merchants.set(`${id}|PROFILE`, { id, sk: 'PROFILE', status: 'active' })

const provision = (merchantId: string, chain = 'TRON') =>
  provisionCustodialAccount({ userId: 'user-1', chain, provider: ProviderName.Tatum, accountingCurrency: 'USD', merchantId })
const seedOf = (merchantId: string, network: string) => seedFromRecoveryPhrase(parameters.get(`/loudibly/hd-seed/${merchantId}/${network}`)!.value)
// The only KMS keys are the seeds' own: one per merchant per network
const accountKeys = () => kmsKeys.filter(k => k.usage !== 'ENCRYPT_DECRYPT').length

// 1. A merchant with no seed yet
check('an account for a merchant with no seed fails', await rejects(provision('acme')))
check('…its virtual account is deactivated', tatum.deactivated.length === 1)

// 2. Accounts
await createSeed('acme', 'TRON')
await createSeed('beta', 'TRON')
const first = await provision('acme', 'TUSDT_TRON')
const second = await provision('acme')
const other = await provision('beta')
check('an account stores its model and index, and no KMS key',
  first.accountRecord.keyModel === 'hd' && first.accountRecord.derivationIndex === 0 && !('kmsKeyId' in first.accountRecord))
check('its address is the one at its index under the merchant\'s seed', first.depositAddress === hdAddress(seedOf('acme', 'TRON'), 'TRON', 0))
check('Tatum is given that address', tatum.assigned.includes(first.depositAddress))
check('the merchant\'s next account gets the next index', second.accountRecord.derivationIndex === 1 && second.depositAddress === hdAddress(seedOf('acme', 'TRON'), 'TRON', 1))
check('another merchant\'s account comes from that merchant\'s seed', other.accountRecord.derivationIndex === 0 && other.depositAddress === hdAddress(seedOf('beta', 'TRON'), 'TRON', 0) && other.depositAddress !== first.depositAddress)
check('no per-account KMS key was created for them', accountKeys() === 0)
check('every account keeps its merchant', first.accountRecord.merchantId === 'acme' && other.accountRecord.merchantId === 'beta')

// 3. A failure after the address was handed out
tatum.failSubscription = true
const before = { removed: tatum.removed.length, deactivated: tatum.deactivated.length }
check('a Tatum failure fails the provisioning', await rejects(provision('acme')))
check('…the address is removed and the virtual account deactivated', tatum.removed.length === before.removed + 1 && tatum.deactivated.length === before.deactivated + 1)
tatum.failSubscription = false
const afterFailure = await provision('acme')
check('the index used by the failed attempt is not handed out again', afterFailure.accountRecord.derivationIndex === 3)

// 4. The stored record is enough for the signer to sign
accounts.set(`${first.accountRecord.id}|${first.accountRecord.sk}`, first.accountRecord)
const { handler } = await import('../../amplify/fn/hd-signer/handler')
process.env.HD_OPERATIONS = 'sign'
const rawDataHex = crypto.randomBytes(100).toString('hex')
const signed = await handler({ op: 'sign', owner: { accountNo: first.accountNo }, rawDataHex })
check('the signer signs for a provisioned account from its stored record', signed.signature === hdSignTron(seedOf('acme', 'TRON'), 0, rawDataHex).signature)

// 5. A caller's failed write
const cancelled = tatum.cancelled.length
await discardProvisionedAccount(ProviderName.Tatum, other, { $fault: 'client' })
check('discarding an account undoes its Tatum side', tatum.cancelled.length === cancelled + 1 && tatum.removed.includes(other.depositAddress))
await discardProvisionedAccount(ProviderName.Tatum, afterFailure, { name: 'TimeoutError' })
check('an unknown write outcome undoes nothing', tatum.cancelled.length === cancelled + 1)

// 6. Merchant masters
const master = await provisionMerchantMaster('gamma', 'TUSDT_TRON', 'USD')
const masterRow = merchants.get('gamma|MASTER#TUSDT_TRON')
check('a master creates its merchant\'s seed when there is none', merchants.get('gamma|SEED#TRON')?.status === 'ready')
check('a master stores its model and index, and no KMS key', masterRow.keyModel === 'hd' && masterRow.derivationIndex === 0 && masterRow.kmsKeyId === undefined && masterRow.status === 'ready')
check('its address is the one at its index', master.depositAddress === hdAddress(seedOf('gamma', 'TRON'), 'TRON', 0))
check('its fee account is created', !!merchants.get('gamma|FEEVA#TUSDT_TRON')?.vAccountId)
await provisionMerchantMaster('gamma', 'TUSDT_TRON', 'USD')
check('provisioning it again changes nothing', merchants.get('gamma|SEED#TRON').nextIndex === 1 && accountKeys() === 0)

finish()
