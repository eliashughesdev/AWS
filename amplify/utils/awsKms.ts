import { KMSClient, CreateKeyCommand, GetPublicKeyCommand, KeySpec, KeyUsageType } from '@aws-sdk/client-kms'
import { keccak256 } from 'js-sha3'
import bs58 from 'bs58'
import { createHash } from 'crypto'

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
 * Creates an AWS KMS asymmetric key for the given chain and returns its ID.
 * The private key never leaves AWS KMS — signing happens on-demand via
 * KMS.Sign() during withdrawals.
 */
export async function createKmsKey(chain: SupportedChain, accountId: string): Promise<string> {
  const keySpec = CHAIN_KEY_SPEC[chain]
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
  return kmsKeyId
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

  // Retrieve the DER-encoded public key
  const pubKeyResult = await kmsClient.send(new GetPublicKeyCommand({ KeyId: kmsKeyId }))
  const derPublicKey = pubKeyResult.PublicKey
  if (!derPublicKey) throw new Error('KMS GetPublicKey did not return a public key')

  const address = deriveAddress(chain, new Uint8Array(derPublicKey as unknown as ArrayBuffer))

  return { kmsKeyId, address }
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
  const hash = keccak256.array(rawPubKey)
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
