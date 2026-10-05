// Checks hdWallet.ts against the published SLIP-0010 test vector and against
// independent implementations (tronweb, @solana/web3.js, Node's Ed25519).
// Exits 1 on any mismatch. Run:
//
//   npx tsx scripts/checks/hdWallet.ts
//
// With HD_CHECK_PHRASE set to a THROWAWAY recovery phrase it also prints that
// phrase's first addresses, to compare by hand with TronLink and Phantom.

import crypto from 'crypto'
import { TronWeb, utils as tronUtils } from 'tronweb'
import { Keypair } from '@solana/web3.js'
import { hdAddress, hdSignSol, hdSignTron, newRecoveryPhrase, seedFromRecoveryPhrase, slip10Ed25519 } from '../../amplify/utils/hdWallet'

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failed++
}
const throws = (fn: () => unknown) => { try { fn(); return false } catch { return true } }

// 1. SLIP-0010, "Test vector 1 for ed25519"
// https://github.com/satoshilabs/slips/blob/master/slip-0010.md
const VECTOR_SEED = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')
const VECTOR: [number[], string, string][] = [
  [[], '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7', '00a4b2856bfec510abab89753fac1ac0e1112364e7d250545963f135f2a33188ed'],
  [[0], '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3', '008c8a13df77a28f3445213a0f432fde644acaa215fc72dcdf300d5efaa85d350c'],
  [[0, 1], 'b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2', '001932a5270f335bed617d5b935c80aedb1a35bd9fc1e31acafd5372c30f5c1187'],
  [[0, 1, 2], '92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9', '00ae98736566d30ed0e9d2f4486a64bc95740d89c7db33f52121f8ea8f76ff0fc1'],
  [[0, 1, 2, 2], '30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662', '008abae2d66361c879b900d204ad2cc4984fa2aa344dd7ddc46007329ac76c429c'],
  [[0, 1, 2, 2, 1000000000], '8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793', '003c24da049451555d51a7014a37337aa4e12d41e485abccfa46b47dfb2af54b7a'],
]
for (const [path, privateKey, publicKey] of VECTOR) {
  const key = slip10Ed25519(VECTOR_SEED, path)
  const label = `SLIP-0010 m/${path.map(i => `${i}'`).join('/')}`
  check(`${label} private key`, hex(key) === privateKey)
  check(`${label} public key`, '00' + hex(Keypair.fromSeed(key).publicKey.toBytes()) === publicKey)
}

// The standard BIP39 test phrase. Never fund it: everyone knows it.
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const seed = seedFromRecoveryPhrase(PHRASE)

// 2. TRON addresses, against tronweb's own derivation
for (const index of [0, 1, 2, 7, 1000]) {
  const expected = TronWeb.fromMnemonic(PHRASE, `m/44'/195'/0'/0/${index}`).address
  const actual = hdAddress(seed, 'TRON', index)
  check(`TRON address at index ${index}`, actual === expected, `${actual} != ${expected}`)
}
check('TRON address at index 0 is the known one', hdAddress(seed, 'TRON', 0) === 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH')

// 3. TRON signature, against tronweb signing with the key tronweb derived
for (const index of [0, 3]) {
  const rawDataHex = crypto.randomBytes(120).toString('hex')
  const { txId, signature } = hdSignTron(seed, index, rawDataHex)
  check(`TRON txId at index ${index} is the SHA-256 of raw_data`, txId === crypto.createHash('sha256').update(Buffer.from(rawDataHex, 'hex')).digest('hex'))

  const tronKey = TronWeb.fromMnemonic(PHRASE, `m/44'/195'/0'/0/${index}`).privateKey.replace(/^0x/, '')
  const expected = tronUtils.crypto.ECKeySign(tronUtils.code.hexStr2byteArray(txId), tronUtils.code.hexStr2byteArray(tronKey))
  check(`TRON signature at index ${index}`, signature === expected.toLowerCase(), `${signature} != ${expected}`)
}

// 4. Solana addresses, against @solana/web3.js building the keypair
for (const index of [0, 1, 2, 7, 1000]) {
  const expected = Keypair.fromSeed(slip10Ed25519(seed, [44, 501, index, 0])).publicKey.toBase58()
  const actual = hdAddress(seed, 'SOL', index)
  check(`Solana address at index ${index}`, actual === expected, `${actual} != ${expected}`)
}
check('Solana address at index 0 is the known one', hdAddress(seed, 'SOL', 0) === 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk', hdAddress(seed, 'SOL', 0))

// 5. Solana signature, verified by Node's own Ed25519 (OpenSSL)
for (const index of [0, 3]) {
  const message = crypto.randomBytes(200)
  const signature = Buffer.from(hdSignSol(seed, index, message), 'hex')
  const publicKey = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Keypair.fromSeed(slip10Ed25519(seed, [44, 501, index, 0])).publicKey.toBytes()]),
    format: 'der',
    type: 'spki',
  })
  check(`Solana signature at index ${index} verifies`, signature.length === 64 && crypto.verify(null, message, publicKey, signature))
}

// 6. Bad input is refused
check('a negative index is refused', throws(() => hdAddress(seed, 'TRON', -1)))
check('a fractional index is refused', throws(() => hdAddress(seed, 'SOL', 1.5)))
check('an index of 2^31 is refused', throws(() => hdAddress(seed, 'SOL', 0x80000000)))
check('an invalid recovery phrase is refused', throws(() => seedFromRecoveryPhrase('abandon abandon abandon')))

// 7. New recovery phrases
const phrase = newRecoveryPhrase()
check('a new recovery phrase has 24 words', phrase.split(' ').length === 24)
check('a new recovery phrase gives a 64-byte seed', seedFromRecoveryPhrase(phrase).length === 64)
check('two new recovery phrases differ', phrase !== newRecoveryPhrase())

if (process.env.HD_CHECK_PHRASE) {
  const own = seedFromRecoveryPhrase(process.env.HD_CHECK_PHRASE.trim())
  console.log('\nAddresses for HD_CHECK_PHRASE:')
  console.log(`  TRON   index 0 (TronLink, first account): ${hdAddress(own, 'TRON', 0)}`)
  for (const index of [0, 1, 2]) console.log(`  Solana index ${index} (Phantom, account ${index + 1}):     ${hdAddress(own, 'SOL', index)}`)
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
