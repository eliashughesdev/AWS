// Runs withdrawals and sweeps end to end against in-memory stand-ins for AWS,
// Tatum and the two chains. The stand-in chains accept a transaction only as
// far as recording who signed it, so each check can say whose key actually
// signed. Exits 1 on any mismatch. Run:
//
//   npx tsx scripts/checks/signing.ts

import crypto from 'crypto'
import axios from 'axios'
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js'
import { TronWeb, utils as tronUtils } from 'tronweb'
import { check, finish, rejects, table } from './standIns'
import { TatumProvider } from '../../amplify/providers/ledger/tatum/tatum'
import { ProviderName } from '../../amplify/providers/ledger/ProviderName'
import { provisionCustodialAccount } from '../../amplify/utils/custodialAccount'
import { provisionMerchantMaster } from '../../amplify/utils/merchantMaster'
import { getMasterAccount } from '../../amplify/utils/masterAccount'
import { createSeed } from '../../amplify/utils/hdSigner'
import { accountKeyRef, signTron } from '../../amplify/utils/signing'
import { handleWithdrawal } from '../../amplify/fn/sqs-processor/webhook/withdrawalHandler'
import { handleSweep } from '../../amplify/fn/sqs-processor/webhook/sweepHandler'

// ---- stand-in chains and Tatum ledger ---------------------------------------

const sha256 = (hex: string) => crypto.createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex')

// The TRON address whose key produced an r + s + v signature over a txID, by tronweb's own recovery
const tronSigner = (txId: string, signature: string) => TronWeb.address.fromHex(tronUtils.crypto.ecRecover(txId, signature))

const unsignedTron = (owner: string, to?: string, amount?: number) => {
  const raw = crypto.randomBytes(120).toString('hex')
  return { txID: sha256(raw), raw_data_hex: raw, raw_data: { owner, to, amount }, visible: true }
}

const ledger = {
  debits: [] as { accountId: string, id: string, amount: string, fee?: string }[],
  completed: [] as string[],
  completedWith: {} as Record<string, string>,
  cancelled: [] as string[],
}
const tronBroadcasts: { txId: string, from: string, to?: string, amount?: number, signedBy: string }[] = []
const solBroadcasts: { txId: string, from: string, to: string, valid: boolean }[] = []

// What each chain's receipt says it charged: TRON in sun, Solana in lamports
const TRON_FEE_SUN = 268_000
const SOL_FEE_LAMPORTS = 5000

// What a sweep reads: balances (TRON in sun, Solana in lamports) and the active TRON addresses.
// Every TRON address has spent its free bandwidth, so a sweep burns 1000 sun a byte
const onChain: Record<string, number> = {}
const activeTron = new Set<string>()
const SOL_RENT_EXEMPT_LAMPORTS = 650_240

Object.assign(axios, {
  post: async (url: string, payload: any) => {
    if (url.endsWith('/offchain/withdrawal')) {
      const id = `wd-${ledger.debits.length + 1}`
      ledger.debits.push({ accountId: payload.senderAccountId, id, amount: payload.amount, fee: payload.fee })
      return { data: { id } }
    }
    if (url.endsWith('/wallet/createtransaction')) return { data: unsignedTron(payload.owner_address, payload.to_address, payload.amount) }
    if (url.endsWith('/tron/broadcast')) {
      const tx = JSON.parse(payload.txData)
      tronBroadcasts.push({ txId: tx.txID, from: tx.raw_data.owner, to: tx.raw_data.to, amount: tx.raw_data.amount, signedBy: tronSigner(tx.txID, tx.signature[0]) })
      return { data: { txId: tx.txID } }
    }
    if (url.endsWith('/wallet/gettransactioninfobyid')) return { data: { id: payload.value, fee: TRON_FEE_SUN } }
    if (url.endsWith('/wallet/getaccountresource')) return { data: { freeNetLimit: 600, freeNetUsed: 600 } }
    if (url.endsWith('/wallet/getaccount')) return { data: activeTron.has(payload.address) ? { address: payload.address } : {} }
    throw new Error(`stand-in: unexpected POST ${url}`)
  },
  get: async (url: string) => {
    if (url.includes('/tron/account/')) return { data: { balance: onChain[url.split('/tron/account/')[1]] ?? 0 } }
    if (url.endsWith('/wallet/getchainparameters')) return { data: { chainParameter: [{ key: 'getTransactionFee', value: 1000 }] } }
    throw new Error(`stand-in: unexpected GET ${url}`)
  },
  put: async (url: string) => {
    const [id, txId] = url.split('/offchain/withdrawal/')[1].split('/')
    ledger.completed.push(id)
    ledger.completedWith[id] = txId
    return { data: {} }
  },
  delete: async (url: string) => { ledger.cancelled.push(url); return { data: {} } },
})

Object.assign(Connection.prototype, {
  getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 }),
  sendRawTransaction: async (raw: Buffer) => {
    const tx = VersionedTransaction.deserialize(raw)
    // A transfer's keys: the payer, the recipient, then the system program
    const [payer, recipient] = tx.message.staticAccountKeys
    const publicKey = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), payer.toBytes()]), format: 'der', type: 'spki' })
    const txId = `sol-tx-${solBroadcasts.length + 1}`
    solBroadcasts.push({ txId, from: payer.toBase58(), to: recipient.toBase58(), valid: crypto.verify(null, tx.message.serialize(), publicKey, tx.signatures[0]) })
    return txId
  },
  getTransaction: async () => ({ meta: { fee: SOL_FEE_LAMPORTS } }),
  getBalance: async (address: PublicKey) => onChain[address.toBase58()] ?? 0,
  getFeeForMessage: async () => ({ context: { slot: 1 }, value: SOL_FEE_LAMPORTS }),
  getMinimumBalanceForRentExemption: async () => SOL_RENT_EXEMPT_LAMPORTS,
})

// ---- accounts ---------------------------------------------------------------

const merchants = table('v1MerchantTable')
const accounts = table('v2CustomerTable')
const balances = table('v1AccountBalanceTable')
const transactions = table('v1TransactionLogsTable')
merchants.set('acme|PROFILE', { id: 'acme', sk: 'PROFILE', status: 'active' })

const open = async (chain: string) => {
  const account = await provisionCustodialAccount({ userId: 'user-1', chain, provider: ProviderName.Tatum, accountingCurrency: 'USD', merchantId: 'acme' })
  accounts.set(`user-1|${account.accountRecord.sk}`, account.accountRecord)
  balances.set(`${account.vAccountId}|`, { ...account.balanceRecord, balance: 10, availableBalance: 10 })
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

await createSeed('acme', 'TRON')
await createSeed('acme', 'SOL')
const hdTron = await open('TRON')
const otherTron = await open('TRON')
const hdSol = await open('SOL')
await provisionMerchantMaster('acme', 'TUSDT_TRON', 'USD')
const hdToken = await open('TUSDT_TRON')
const master = (await getMasterAccount('acme', 'TUSDT_TRON'))!

// 1. Choosing the key from a stored record
check('an account\'s key names it by account number', JSON.stringify(accountKeyRef(hdTron.accountRecord)) === JSON.stringify({ accountNo: hdTron.accountNo }))
check('an old KMS-model record has no key', accountKeyRef({ accountNo: 'x', chain: 'TRON', kmsKeyId: 'an-old-kms-key' }) === null)
check('a master\'s key names it by merchant and currency', JSON.stringify(master.key) === JSON.stringify({ merchantId: 'acme', currency: 'TUSDT_TRON' }))

// 2. Signing a TRON transaction
const tx = unsignedTron(hdTron.depositAddress)
check('a signature is by the account\'s own key', tronSigner(tx.txID, await signTron(accountKeyRef(hdTron.accountRecord)!, tx)) === hdTron.depositAddress)
check('…and not by another account\'s', tronSigner(tx.txID, await signTron(accountKeyRef(otherTron.accountRecord)!, tx)) === otherTron.depositAddress && otherTron.depositAddress !== hdTron.depositAddress)
check('a txID that is not the hash of its raw_data is refused', await rejects(signTron(accountKeyRef(hdTron.accountRecord)!, { ...tx, txID: 'ab'.repeat(32) })))

// 3. Withdrawals, through the real handler and the real Tatum provider
const destination = otherTron.depositAddress
check('a TRON account\'s withdrawal is processed', await handleWithdrawal(withdrawal(hdTron.vAccountId, destination)))
check('…sent from its own address and signed by its own key', tronBroadcasts.at(-1)?.from === hdTron.depositAddress && tronBroadcasts.at(-1)?.signedBy === hdTron.depositAddress)
check('…its Tatum account is the one debited, and the withdrawal completed', ledger.debits.at(-1)?.accountId === hdTron.vAccountId && ledger.completed.includes(ledger.debits.at(-1)!.id))

check('a Solana account\'s withdrawal is processed', await handleWithdrawal(withdrawal(hdSol.vAccountId, hdSol.depositAddress)))
check('…paid by its own address with a signature that verifies', solBroadcasts.at(-1)?.from === hdSol.depositAddress && solBroadcasts.at(-1)?.valid === true)

const debits = ledger.debits.length
check('a withdrawal for an account that does not exist is not processed', !(await handleWithdrawal(withdrawal('va-nope', destination))) && ledger.debits.length === debits)

// 3b. Once the merchant has a native master, native withdrawals go through it too
// (native-sweep-plan step 2), and the fee the master paid is charged to the customer
await provisionMerchantMaster('acme', 'TRON', 'USD')
await provisionMerchantMaster('acme', 'SOL', 'USD')
const tronMaster = (await getMasterAccount('acme', 'TRON'))!
const solMaster = (await getMasterAccount('acme', 'SOL'))!

const nativeWithdrawal = async (account: typeof hdTron, master: typeof tronMaster, to: string, fee: string) => {
  const from = ledger.debits.length
  const processed = await handleWithdrawal(withdrawal(account.vAccountId, to))
  const [customerDebit, masterDebit, customerFee, masterFee, ...more] = ledger.debits.slice(from)
  const txId = ledger.completedWith[customerDebit?.id]
  const feeRow = transactions.get(`${account.vAccountId}|TX#${txId}`)
  return {
    processed,
    bothDebited: customerDebit?.accountId === account.vAccountId && masterDebit?.accountId === master.vAccountId &&
      customerDebit.fee === '0' && masterDebit.fee === '0' && ledger.completedWith[masterDebit.id] === txId,
    feeOffBothVAs: customerFee?.accountId === account.vAccountId && masterFee?.accountId === master.vAccountId &&
      customerFee.amount === fee && masterFee.amount === fee && more.length === 0 &&
      ledger.completedWith[customerFee.id] === txId && ledger.completedWith[masterFee.id] === txId,
    feeRow: feeRow?.type === 'FEE' && feeRow.amount === Number(fee) && feeRow.from === master.depositAddress,
    balance: balances.get(`${account.vAccountId}|`)?.availableBalance,
  }
}

const tronWithdrawal = await nativeWithdrawal(hdTron, tronMaster, destination, '0.268')
check('a TRX withdrawal of a merchant with a native master is signed by the master',
  tronWithdrawal.processed && tronBroadcasts.at(-1)?.from === tronMaster.depositAddress && tronBroadcasts.at(-1)?.signedBy === tronMaster.depositAddress)
check('…both the customer\'s and the master\'s VA are debited, with no fixed fee, and completed with its txId', tronWithdrawal.bothDebited)
check('…the receipt\'s fee comes off both VAs, completed with the same txId', tronWithdrawal.feeOffBothVAs)
check('…and is the customer\'s FEE row, paid by the master, off their balance', tronWithdrawal.feeRow && tronWithdrawal.balance === 10 - 0.268, `availableBalance ${tronWithdrawal.balance}`)

const solWithdrawal = await nativeWithdrawal(hdSol, solMaster, hdSol.depositAddress, '0.000005')
check('a SOL withdrawal of a merchant with a native master is paid by the master, with a signature that verifies',
  solWithdrawal.processed && solBroadcasts.at(-1)?.from === solMaster.depositAddress && solBroadcasts.at(-1)?.valid === true)
check('…both VAs are debited, and the receipt\'s fee comes off both', solWithdrawal.bothDebited && solWithdrawal.feeOffBothVAs)
check('…and is the customer\'s FEE row', solWithdrawal.feeRow && solWithdrawal.balance === 10 - 0.000005, `availableBalance ${solWithdrawal.balance}`)

// 3c. A native deposit is swept whole to its merchant's native master (native-sweep-plan
// step 3), signed by the account that received it, and the customer's VA pays the fee
// What balanceUpdateHandler queues, plus the key fields an attacker would want honoured
const sweepOf = (account: typeof hdTron, depositTxId: string) => handleSweep({
  vAccountId: account.vAccountId,
  senderAddress: account.depositAddress,
  amount: 5,
  txId: depositTxId,
  kmsKeyId: 'someone-elses-key',
  merchantId: 'someone-else',
  currency: 'TUSDT_TRON',
})
const lastFeeDebit = () => {
  const debit = ledger.debits.at(-1)
  return { ...debit, completedWith: debit && ledger.completedWith[debit.id] }
}

onChain[hdTron.depositAddress] = 10_000_000
const sentBefore = tronBroadcasts.length
check('a TRX deposit is not swept while the TRON master is not active', !(await sweepOf(hdTron, 'deposit-tron-0')) && tronBroadcasts.length === sentBefore)

activeTron.add(tronMaster.depositAddress)
const tronSweepDone = await sweepOf(hdTron, 'deposit-tron-1')
const tronSweep = tronBroadcasts.at(-1)
const tronSweepFee = lastFeeDebit()
check('a native sweep is signed by the account that received the deposit, to its own merchant\'s native master',
  tronSweepDone && tronSweep?.from === hdTron.depositAddress && tronSweep?.signedBy === hdTron.depositAddress && tronSweep?.to === tronMaster.depositAddress)
// The stand-in's transactions are 253 bytes once signed
check('…it sends the whole balance minus the fee it burns', tronSweep?.amount === 10_000_000 - 253_000, `amount ${tronSweep?.amount}`)
check('…and that fee comes off the customer\'s VA, completed with the sweep\'s txId',
  tronSweepFee.accountId === hdTron.vAccountId && tronSweepFee.amount === '0.253' && tronSweepFee.completedWith === tronSweep?.txId)

onChain[hdSol.depositAddress] = 1_000_000
onChain[solMaster.depositAddress] = SOL_RENT_EXEMPT_LAMPORTS
const solSweepDone = await sweepOf(hdSol, 'deposit-sol-1')
const solSweep = solBroadcasts.at(-1)
const solSweepFee = lastFeeDebit()
check('a SOL sweep is paid by the account that received the deposit, to its own merchant\'s SOL master, with a signature that verifies',
  solSweepDone && solSweep?.from === hdSol.depositAddress && solSweep?.to === solMaster.depositAddress && solSweep?.valid === true)
check('…and its fee comes off the customer\'s VA, completed with the sweep\'s txId',
  solSweepFee.accountId === hdSol.vAccountId && solSweepFee.amount === '0.000005' && solSweepFee.completedWith === solSweep?.txId)

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

// 5. An old KMS-model master
merchants.set('beta|MASTER#USDT_TRON', { id: 'beta', sk: 'MASTER#USDT_TRON', currency: 'USDT_TRON', status: 'ready', kmsKeyId: 'an-old-kms-key', depositAddress: 'T-none', vAccountId: 'va-x' })
check('a master that is not a derived wallet is not used', (await getMasterAccount('beta', 'USDT_TRON')) === null)

finish()
