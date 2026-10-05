// Runs withdrawals and sweeps end to end against in-memory stand-ins for AWS,
// Tatum and the two chains, for KMS-model and derived accounts alike. The
// stand-in chains accept a transaction only as far as recording who signed it,
// so each check can say whose key actually signed. Exits 1 on any mismatch. Run:
//
//   npx tsx scripts/checks/signing.ts

import crypto from 'crypto'
import axios from 'axios'
import { Connection, VersionedTransaction } from '@solana/web3.js'
import { secp256k1 } from '@noble/curves/secp256k1'
import { check, finish, rejects, table, useKeyModel } from './standIns'
import { TatumProvider } from '../../amplify/providers/ledger/tatum/tatum'
import { ProviderName } from '../../amplify/providers/ledger/ProviderName'
import { deriveAddress } from '../../amplify/utils/awsKms'
import { provisionCustodialAccount } from '../../amplify/utils/custodialAccount'
import { provisionMerchantMaster } from '../../amplify/utils/merchantMaster'
import { getMasterAccount } from '../../amplify/utils/masterAccount'
import { createSeed } from '../../amplify/utils/hdSigner'
import { accountKeyRef, signTron } from '../../amplify/utils/signing'
import { handleWithdrawal } from '../../amplify/fn/sqs-processor/webhook/withdrawalHandler'
import { handleSweep } from '../../amplify/fn/sqs-processor/webhook/sweepHandler'

// ---- stand-in chains and Tatum ledger ---------------------------------------

const sha256 = (hex: string) => crypto.createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex')

// The TRON address whose key produced an r + s + v signature over a txID
const tronSigner = (txId: string, signature: string) => {
  const recovered = secp256k1.Signature.fromCompact(signature.slice(0, 128))
    .addRecoveryBit(parseInt(signature.slice(128), 16) - 27)
    .recoverPublicKey(txId)
  return deriveAddress('TRON', recovered.toRawBytes(false))
}

const unsignedTron = (owner: string) => {
  const raw = crypto.randomBytes(120).toString('hex')
  return { txID: sha256(raw), raw_data_hex: raw, raw_data: { owner }, visible: true }
}

const ledger = { debits: [] as { accountId: string, id: string }[], completed: [] as string[], cancelled: [] as string[] }
const tronBroadcasts: { from: string, signedBy: string }[] = []
const solBroadcasts: { from: string, valid: boolean }[] = []

Object.assign(axios, {
  post: async (url: string, payload: any) => {
    if (url.endsWith('/offchain/withdrawal')) {
      const id = `wd-${ledger.debits.length + 1}`
      ledger.debits.push({ accountId: payload.senderAccountId, id })
      return { data: { id } }
    }
    if (url.endsWith('/wallet/createtransaction')) return { data: unsignedTron(payload.owner_address) }
    if (url.endsWith('/tron/broadcast')) {
      const tx = JSON.parse(payload.txData)
      tronBroadcasts.push({ from: tx.raw_data.owner, signedBy: tronSigner(tx.txID, tx.signature[0]) })
      return { data: { txId: tx.txID } }
    }
    throw new Error(`stand-in: unexpected POST ${url}`)
  },
  put: async (url: string) => { ledger.completed.push(url.split('/offchain/withdrawal/')[1].split('/')[0]); return { data: {} } },
  delete: async (url: string) => { ledger.cancelled.push(url); return { data: {} } },
})

Object.assign(Connection.prototype, {
  getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 }),
  sendRawTransaction: async (raw: Buffer) => {
    const tx = VersionedTransaction.deserialize(raw)
    const payer = tx.message.staticAccountKeys[0]
    const publicKey = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), payer.toBytes()]), format: 'der', type: 'spki' })
    solBroadcasts.push({ from: payer.toBase58(), valid: crypto.verify(null, tx.message.serialize(), publicKey, tx.signatures[0]) })
    return `sol-tx-${solBroadcasts.length}`
  },
})

// ---- accounts ---------------------------------------------------------------

const merchants = table('v1MerchantTable')
const accounts = table('v2CustomerTable')
merchants.set('acme|PROFILE', { id: 'acme', sk: 'PROFILE', status: 'active' })

const open = async (chain: string) => {
  const account = await provisionCustodialAccount({ userId: 'user-1', chain, provider: ProviderName.Tatum, accountingCurrency: 'USD', merchantId: 'acme' })
  accounts.set(`user-1|${account.accountRecord.sk}`, account.accountRecord)
  return account
}
// What /accounts/withdraw queues, plus the key fields an attacker would want honoured
const withdrawal = (vAccountId: string, destinationAddress: string) => ({
  transactionId: `tx-${crypto.randomUUID()}`,
  userId: 'user-1',
  vAccountId,
  cryptoAmount: 1,
  destinationAddress,
  kmsKeyId: 'someone-elses-key',
  senderAddress: 'someone-elses-address',
  merchantId: 'someone-else',
  chain: 'TRON',
})

useKeyModel()
const kmsTron = await open('TRON')
useKeyModel('hd')
await createSeed('acme', 'TRON')
await createSeed('acme', 'SOL')
const hdTron = await open('TRON')
const hdSol = await open('SOL')
const hdToken = await open('TUSDT_TRON')
await provisionMerchantMaster('acme', 'TUSDT_TRON', 'USD')
const master = (await getMasterAccount('acme', 'TUSDT_TRON'))!

// 1. Choosing the key from a stored record
check('a derived account\'s key is the signer, named by account number', JSON.stringify(accountKeyRef(hdTron.accountRecord)) === JSON.stringify({ keyModel: 'hd', owner: { accountNo: hdTron.accountNo } }))
check('a KMS account\'s key is its KMS key', JSON.stringify(accountKeyRef(kmsTron.accountRecord)) === JSON.stringify({ keyModel: 'kms', kmsKeyId: kmsTron.kmsKeyId }))
check('a record with neither has no key', accountKeyRef({ accountNo: 'x', chain: 'TRON' }) === null)
check('a derived master\'s key is the signer, named by merchant and currency', JSON.stringify(master.key) === JSON.stringify({ keyModel: 'hd', owner: { merchantId: 'acme', currency: 'TUSDT_TRON' } }))

// 2. Signing a TRON transaction either way
const tx = unsignedTron(hdTron.depositAddress)
check('the signer\'s signature is by the derived account\'s own key', tronSigner(tx.txID, await signTron(accountKeyRef(hdTron.accountRecord)!, tx, hdTron.depositAddress)) === hdTron.depositAddress)
check('a KMS signature is by the KMS account\'s own key', tronSigner(tx.txID, await signTron(accountKeyRef(kmsTron.accountRecord)!, tx, kmsTron.depositAddress)) === kmsTron.depositAddress)
check('a txID that is not the hash of its raw_data is refused', await rejects(signTron(accountKeyRef(hdTron.accountRecord)!, { ...tx, txID: 'ab'.repeat(32) }, hdTron.depositAddress)))

// 3. Withdrawals, through the real handler and the real Tatum provider
const destination = kmsTron.depositAddress
check('a derived TRON account\'s withdrawal is processed', await handleWithdrawal(withdrawal(hdTron.vAccountId, destination)))
check('…sent from its own address and signed by its own key', tronBroadcasts.at(-1)?.from === hdTron.depositAddress && tronBroadcasts.at(-1)?.signedBy === hdTron.depositAddress)
check('…its Tatum account is the one debited, and the withdrawal completed', ledger.debits.at(-1)?.accountId === hdTron.vAccountId && ledger.completed.includes(ledger.debits.at(-1)!.id))

check('a KMS TRON account\'s withdrawal is still processed', await handleWithdrawal(withdrawal(kmsTron.vAccountId, hdTron.depositAddress)))
check('…sent from its own address and signed by its own key', tronBroadcasts.at(-1)?.from === kmsTron.depositAddress && tronBroadcasts.at(-1)?.signedBy === kmsTron.depositAddress)

check('a derived Solana account\'s withdrawal is processed', await handleWithdrawal(withdrawal(hdSol.vAccountId, hdSol.depositAddress)))
check('…paid by its own address with a signature that verifies', solBroadcasts.at(-1)?.from === hdSol.depositAddress && solBroadcasts.at(-1)?.valid === true)

const debits = ledger.debits.length
check('a withdrawal for an account that does not exist is not processed', !(await handleWithdrawal(withdrawal('va-nope', destination))) && ledger.debits.length === debits)

// 4. Token withdrawals and sweeps go through the master: what the handlers ask the provider for
const asked: any[] = []
const real = { withdrawFunds: TatumProvider.prototype.withdrawFunds, sendOnChain: TatumProvider.prototype.sendOnChain }
Object.assign(TatumProvider.prototype, {
  withdrawFunds: async (params: any) => { asked.push(params); return { withdrawalId: 'wd', txId: 'tx' } },
  sendOnChain: async (params: any) => { asked.push(params); return { txId: 'tx' } },
})

await handleWithdrawal(withdrawal(hdToken.vAccountId, destination))
check('a token withdrawal debits the customer but signs as the merchant\'s master',
  asked.at(-1).accountId === hdToken.vAccountId && asked.at(-1).senderAddress === master.depositAddress &&
  JSON.stringify(asked.at(-1).key) === JSON.stringify(master.key) && asked.at(-1).masterAccountId === master.vAccountId)

await handleSweep({ vAccountId: hdToken.vAccountId, senderAddress: hdToken.depositAddress, amount: 5, txId: 'deposit-1', kmsKeyId: 'someone-elses-key', merchantId: 'someone-else', currency: 'TRON' })
check('a sweep is signed by the account that received the deposit, to its own merchant\'s master',
  asked.at(-1).senderAddress === hdToken.depositAddress && asked.at(-1).recipientAddress === master.depositAddress &&
  asked.at(-1).chain === 'TUSDT_TRON' && JSON.stringify(asked.at(-1).key) === JSON.stringify(accountKeyRef(hdToken.accountRecord)))

Object.assign(TatumProvider.prototype, real)

// 5. Masters
useKeyModel()
merchants.set('beta|PROFILE', { id: 'beta', sk: 'PROFILE', status: 'active' })
await provisionMerchantMaster('beta', 'TUSDT_TRON', 'USD')
check('a KMS master\'s key is its KMS key', (await getMasterAccount('beta', 'TUSDT_TRON'))?.key.keyModel === 'kms')
merchants.set('beta|MASTER#USDT_TRON', { id: 'beta', sk: 'MASTER#USDT_TRON', currency: 'USDT_TRON', status: 'ready', depositAddress: 'T-none', vAccountId: 'va-x' })
check('a master with no key is not used', (await getMasterAccount('beta', 'USDT_TRON')) === null)

finish()
