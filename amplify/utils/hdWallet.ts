import { HDKey } from '@scure/bip32'
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { secp256k1 } from '@noble/curves/secp256k1'
import { ed25519 } from '@noble/curves/ed25519'
import { hmac } from '@noble/hashes/hmac'
import { sha256, sha512 } from '@noble/hashes/sha2'
import { keccak_256 as keccak256 } from '@noble/hashes/sha3'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils'
import bs58 from 'bs58'
import type { Network } from './currencies'

/**
 * Derived (HD) wallets: one seed gives every account its own key by index.
 * Pure code with no AWS calls; whoever calls it holds the seed and wipes it.
 *
 *   TRON    m/44'/195'/0'/0/<index>   BIP32 over secp256k1
 *   Solana  m/44'/501'/<index>'/0'    SLIP-0010 over Ed25519 (hardened levels only)
 *
 * Private keys never leave this module: callers get addresses and signatures.
 */

const HARDENED = 0x80000000

const assertIndex = (index: number) => {
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED) throw new Error(`Invalid derivation index: ${index}`)
}

// A seed is kept as a 24-word BIP39 phrase so it can be restored in any standard wallet
export const newRecoveryPhrase = (): string => generateMnemonic(wordlist, 256)

export const seedFromRecoveryPhrase = (phrase: string): Uint8Array => {
  if (!validateMnemonic(phrase, wordlist)) throw new Error('Invalid recovery phrase')
  return mnemonicToSeedSync(phrase)
}

const tronPrivateKey = (seed: Uint8Array, index: number): Uint8Array => {
  assertIndex(index)
  const node = HDKey.fromMasterSeed(seed).derive(`m/44'/195'/0'/0/${index}`)
  const key = node.privateKey!.slice()
  node.wipePrivateData()
  return key
}

// Keccak-256 of the uncompressed public key, last 20 bytes, 0x41 prefix, Base58Check
const tronAddress = (privateKey: Uint8Array): string => {
  const publicKey = secp256k1.getPublicKey(privateKey, false)
  const payload = concatBytes(Uint8Array.of(0x41), keccak256(publicKey.subarray(1)).subarray(-20))
  return bs58.encode(concatBytes(payload, sha256(sha256(payload)).subarray(0, 4)))
}

/** SLIP-0010 private key for Ed25519. Every level of `path` is hardened. */
export const slip10Ed25519 = (seed: Uint8Array, path: number[]): Uint8Array => {
  let node = hmac(sha512, utf8ToBytes('ed25519 seed'), seed) // key (32) || chain code (32)
  for (const index of path) {
    assertIndex(index)
    const data = new Uint8Array(37) // 0x00 || parent key || index + 2^31
    data.set(node.subarray(0, 32), 1)
    new DataView(data.buffer).setUint32(33, index + HARDENED)
    const child = hmac(sha512, node.subarray(32), data)
    node.fill(0)
    data.fill(0)
    node = child
  }
  const key = node.slice(0, 32)
  node.fill(0)
  return key
}

const solPrivateKey = (seed: Uint8Array, index: number): Uint8Array => slip10Ed25519(seed, [44, 501, index, 0])

/** The deposit address of the account at `index` under this seed. */
export const hdAddress = (seed: Uint8Array, network: Network, index: number): string => {
  const key = network === 'TRON' ? tronPrivateKey(seed, index) : solPrivateKey(seed, index)
  try {
    return network === 'TRON' ? tronAddress(key) : bs58.encode(ed25519.getPublicKey(key))
  } finally {
    key.fill(0)
  }
}

/**
 * Signs a TRON transaction given its `raw_data_hex`. The transaction id is
 * hashed here, not taken from the caller, so what is signed is a transaction.
 * The signature is r (32) || s (32) || v (27 or 28), with a low s.
 */
export const hdSignTron = (seed: Uint8Array, index: number, rawDataHex: string): { txId: string, signature: string } => {
  const key = tronPrivateKey(seed, index)
  try {
    const txId = sha256(hexToBytes(rawDataHex))
    const signature = secp256k1.sign(txId, key)
    return {
      txId: bytesToHex(txId),
      signature: bytesToHex(signature.toCompactRawBytes()) + (signature.recovery + 27).toString(16),
    }
  } finally {
    key.fill(0)
  }
}

/** Ed25519 signature (64 bytes, hex) over a serialized Solana message. */
export const hdSignSol = (seed: Uint8Array, index: number, message: Uint8Array): string => {
  const key = solPrivateKey(seed, index)
  try {
    return bytesToHex(ed25519.sign(message, key))
  } finally {
    key.fill(0)
  }
}
