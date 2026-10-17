import { signWithSeed, type SeedOwner } from './hdSigner'

/**
 * What signs for an account or a master: the record the signer looks up to
 * find its seed and index. Built from a stored record, never from a queue
 * message.
 */
export type KeyRef = SeedOwner

/** The key of a stored account record, or null when it isn't a derived-wallet account. */
export const accountKeyRef = (account: Record<string, any>): KeyRef | null =>
  account.keyModel === 'hd' && account.accountNo ? { accountNo: account.accountNo } : null

/** Signs an unsigned TRON transaction as the node returned it. r + s + v, hex. */
export const signTron = async (key: KeyRef, unsignedTx: { txID: string, raw_data_hex: string }): Promise<string> => {
  const { txId, signature } = await signWithSeed(key, { rawDataHex: unsignedTx.raw_data_hex })
  // The signer hashes raw_data itself, so this catches a txID that isn't that transaction's
  if (txId !== unsignedTx.txID) throw new Error(`TRON txID ${unsignedTx.txID} is not the hash of its raw_data (${txId})`)
  return signature
}

/** Signs a serialized Solana message. 64 bytes, hex. */
export const signSol = async (key: KeyRef, message: Uint8Array): Promise<string> => {
  const { signature } = await signWithSeed(key, { messageBase64: Buffer.from(message).toString('base64') })
  return signature
}
