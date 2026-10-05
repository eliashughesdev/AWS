import { KMSClient, CreateKeyCommand, GetPublicKeyCommand, ScheduleKeyDeletionCommand, SignCommand, SigningAlgorithmSpec, MessageType, KeySpec, KeyUsageType } from '@aws-sdk/client-kms'
// js-sha3 is CommonJS: a default import works bundled and unbundled alike
import sha3 from 'js-sha3'
import bs58 from 'bs58'
import { createHash } from 'crypto'
import * as secp256k1 from '@noble/secp256k1'

const kmsClient = new KMSClient({})

type SupportedChain = 'TRON' | 'SOL'

const CHAIN_KEY_SPEC: Record<SupportedChain, KeySpec> = {
  TRON: 'ECC_SECG_P256K1',
  SOL: 'ECC_NIST_EDWARDS25519',
}

const ADDRESS_DERIVER: Record<SupportedChain, (derPublicKey: Uint8Array) => string> = {
  TRON: deriveTronAddress,
  SOL: deriveSolAddress,
}

/**
 * Creates an AWS KMS asymmetric key for the given chain and derives the
 * corresponding blockchain deposit address from the public key.
 *
 * The private key never leaves AWS KMS — signing happens on-demand via
 * KMS.Sign() during withdrawals (implemented separately).
 */
export async function createBlockchainKey(
  chain: SupportedChain,
  accountId: string
): Promise<{ kmsKeyId: string; address: string }> {
  const keySpec = CHAIN_KEY_SPEC[chain]

  // Create the asymmetric key
  const createResult = await kmsClient.send(
    new CreateKeyCommand({
      KeySpec: keySpec,
      KeyUsage: KeyUsageType.SIGN_VERIFY,
      Description: `Blockchain key for ${chain} account ${accountId}`,
      Tags: [
        { TagKey: 'chain', TagValue: chain },
        { TagKey: 'accountId', TagValue: accountId },
        { TagKey: 'service', TagValue: 'loudibly' },
      ],
    })
  )

  const kmsKeyId = createResult.KeyMetadata?.KeyId
  if (!kmsKeyId) throw new Error('KMS CreateKey did not return a KeyId')

  try {
    // Retrieve the DER-encoded public key
    const pubKeyResult = await kmsClient.send(new GetPublicKeyCommand({ KeyId: kmsKeyId }))
    const derPublicKey = pubKeyResult.PublicKey
    if (!derPublicKey) throw new Error('KMS GetPublicKey did not return a public key')

    const address = deriveAddress(chain, new Uint8Array(derPublicKey as unknown as ArrayBuffer))

    return { kmsKeyId, address }
  } catch (err) {
    // The caller never learns this key id, so it can only be removed here
    await scheduleKeyDeletion(kmsKeyId).catch(e => console.error(`KMS key ${kmsKeyId} is orphaned: ${e.message}`))
    throw err
  }
}

/**
 * Schedules a key for deletion after KMS's minimum 7-day wait, during which
 * `aws kms cancel-key-deletion` still recovers it.
 */
export async function scheduleKeyDeletion(kmsKeyId: string): Promise<void> {
  await kmsClient.send(new ScheduleKeyDeletionCommand({ KeyId: kmsKeyId, PendingWindowInDays: 7 }))
}

/**
 * Derives the blockchain address from a DER-encoded AWS KMS public key.
 */
export function deriveAddress(chain: SupportedChain, derPublicKey: Uint8Array): string {
  return ADDRESS_DERIVER[chain](derPublicKey)
}

/**
 * TRON address derivation from a secp256k1 DER public key (88 bytes from AWS KMS):
 *   DER → uncompressed point (04 || x || y, 65 bytes, last 65 bytes of DER)
 *   → strip 04 prefix → 64 raw bytes
 *   → Keccak256 → last 20 bytes
 *   → prepend 0x41 (TRON mainnet prefix)
 *   → double-SHA256 checksum (first 4 bytes)
 *   → Base58(prefix_21_bytes + checksum_4_bytes)
 */
function deriveTronAddress(derPublicKey: Uint8Array): string {
  // Last 65 bytes of the DER are: 04 || x(32) || y(32)
  const uncompressed = derPublicKey.slice(-65)
  if (uncompressed[0] !== 0x04) {
    throw new Error('Expected uncompressed secp256k1 point (0x04 prefix)')
  }

  // Drop the 04 prefix → 64 bytes (raw x || y)
  const rawPubKey = uncompressed.slice(1)

  // Keccak256, take last 20 bytes
  const hash = sha3.keccak256.array(rawPubKey)
  const addressBytes = new Uint8Array(hash).slice(-20)

  // Prepend TRON mainnet byte (0x41)
  const prefixed = new Uint8Array(21)
  prefixed[0] = 0x41
  prefixed.set(addressBytes, 1)

  // Double SHA256 → first 4 bytes = checksum
  const firstHash = createHash('sha256').update(prefixed).digest()
  const checksum = createHash('sha256').update(firstHash).digest().slice(0, 4)

  // Base58(prefixed + checksum) → T... address
  const payload = new Uint8Array(25)
  payload.set(prefixed, 0)
  payload.set(checksum, 21)

  return bs58.encode(payload)
}

/**
 * Solana address derivation from an Ed25519 DER public key (44 bytes from AWS KMS):
 *   DER SubjectPublicKeyInfo → last 32 bytes = raw Ed25519 public key
 *   → Base58 encode → standard Solana public key (~44 chars)
 */
function deriveSolAddress(derPublicKey: Uint8Array): string {
  // Last 32 bytes of the DER are the raw Ed25519 public key
  const rawKey = derPublicKey.slice(-32)
  return bs58.encode(rawKey)
}

// ---------------------------------------------------------------------------
// On-demand signing (used by the withdrawal handler)
// ---------------------------------------------------------------------------

/**
 * Signs a TRON transaction hash with AWS KMS (secp256k1 / ECDSA_SHA_256).
 *
 * AWS KMS returns a DER-encoded signature. TRON expects r(32) + s(32) + v(1)
 * where v = 27 or 28. We derive the correct recovery byte by comparing the
 * ecrecover result for each candidate against the known sender address.
 *
 * @param kmsKeyId      AWS KMS key ID stored on the account record
 * @param txId          hex string — the 32-byte transaction hash from TronGrid
 * @param senderAddress TRON base58 address of the sending account
 * @returns 65-byte signature as a hex string (r + s + v)
 */
export async function signTronTransaction(
  kmsKeyId: string,
  txId: string,
  senderAddress: string
): Promise<string> {
  const msgHash = Buffer.from(txId, 'hex')

  const result = await kmsClient.send(new SignCommand({
    KeyId: kmsKeyId,
    Message: msgHash,
    SigningAlgorithm: SigningAlgorithmSpec.ECDSA_SHA_256,
    MessageType: MessageType.DIGEST,
  }))

  const derSig = Buffer.from(result.Signature as Uint8Array)
  const { r, s } = parseDerSignature(derSig)

  // Try recovery values 0 and 1; pick whichever produces the expected address
  for (const recovery of [0, 1]) {
    try {
      const sig = new secp256k1.Signature(
        BigInt('0x' + r.toString('hex')),
        BigInt('0x' + s.toString('hex')),
        recovery
      )
      const recoveredPubKey = sig.recoverPublicKey(msgHash)
      // recoverPublicKey returns a Point; get uncompressed 65-byte form
      const uncompressed = recoveredPubKey.toRawBytes(false) // 65 bytes: 04 || x || y
      const recoveredAddress = deriveTronAddress(uncompressed)
      if (recoveredAddress === senderAddress) {
        const sigBytes = Buffer.concat([r, s, Buffer.from([recovery + 27])])
        return sigBytes.toString('hex')
      }
    } catch {
      // recovery failed for this value — try the other one
    }
  }

  throw new Error(`Could not determine TRON signature recovery byte for sender ${senderAddress}`)
}

/**
 * Signs a Solana transaction message with AWS KMS (Ed25519 / EDDSA).
 * AWS KMS added native EdDSA support in November 2025.
 *
 * @param kmsKeyId   AWS KMS key ID stored on the account record
 * @param txBytes    raw transaction bytes to sign (Uint8Array or Buffer)
 * @returns 64-byte Ed25519 signature as a hex string
 */
export async function signSolTransaction(
  kmsKeyId: string,
  txBytes: Uint8Array
): Promise<string> {
  const result = await kmsClient.send(new SignCommand({
    KeyId: kmsKeyId,
    Message: txBytes,
    SigningAlgorithm: 'ED25519_SHA_512' as SigningAlgorithmSpec,
    MessageType: MessageType.RAW,
  }))

  return Buffer.from(result.Signature as Uint8Array).toString('hex')
}

/**
 * Parses a DER-encoded ECDSA signature into its r and s components (32 bytes each).
 * DER format: 0x30 [total-len] 0x02 [r-len] [r] 0x02 [s-len] [s]
 */
function parseDerSignature(der: Buffer): { r: Buffer; s: Buffer } {
  let offset = 2 // skip 0x30 and total length
  const rLen = der[offset + 1]
  const rRaw = der.subarray(offset + 2, offset + 2 + rLen)
  offset = offset + 2 + rLen
  const sLen = der[offset + 1]
  const sRaw = der.subarray(offset + 2, offset + 2 + sLen)

  // DER may prefix a 0x00 byte when the high bit is set — strip it and pad to 32
  const r = Buffer.alloc(32)
  const s = Buffer.alloc(32)
  rRaw.subarray(-32).copy(r, 32 - Math.min(rRaw.length, 32))
  sRaw.subarray(-32).copy(s, 32 - Math.min(sRaw.length, 32))

  return { r, s }
}
