import { signSolTransaction, signTronTransaction } from './awsKms'
import { signWithSeed, type SeedOwner } from './hdSigner'

/**
 * What signs for an account or a master: its own KMS key, or the signer under
 * its merchant's seed. Built from a stored record, never from a queue message.
 */
export type KeyRef =
  | { keyModel: 'kms', kmsKeyId: string }
  | { keyModel: 'hd', owner: SeedOwner }

/** The key of a stored account record, or null when it has none. */
export const accountKeyRef = (account: Record<string, any>): KeyRef | null => {
  if (account.keyModel === 'hd') return account.accountNo ? { keyModel: 'hd', owner: { accountNo: account.accountNo } } : null
  return account.kmsKeyId ? { keyModel: 'kms', kmsKeyId: account.kmsKeyId } : null
}

/** Signs an unsigned TRON transaction as the node returned it. r + s + v, hex. */
export const signTron = async (key: KeyRef, unsignedTx: { txID: string, raw_data_hex: string }, senderAddress: string): Promise<string> => {
  if (key.keyModel === 'kms') return signTronTransaction(key.kmsKeyId, unsignedTx.txID, senderAddress)

  const { txId, signature } = await signWithSeed(key.owner, { rawDataHex: unsignedTx.raw_data_hex })
  // The signer hashes raw_data itself, so this catches a txID that isn't that transaction's
  if (txId !== unsignedTx.txID) throw new Error(`TRON txID ${unsignedTx.txID} is not the hash of its raw_data (${txId})`)
  return signature
}

/** Signs a serialized Solana message. 64 bytes, hex. */
export const signSol = async (key: KeyRef, message: Uint8Array): Promise<string> => {
  if (key.keyModel === 'kms') return signSolTransaction(key.kmsKeyId, message)

  const { signature } = await signWithSeed(key.owner, { messageBase64: Buffer.from(message).toString('base64') })
  return signature
}
