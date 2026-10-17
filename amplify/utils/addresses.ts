import bs58 from 'bs58'
import { isValidTronAddress } from '../providers/ledger/tatum/chains/tron'
import { networkFor } from './currencies'

// A Solana address: base58 of a 32-byte public key
export const isValidSolanaAddress = (address: unknown): boolean => {
  if (typeof address !== 'string') return false
  try {
    return bs58.decode(address).length === 32
  } catch {
    return false
  }
}

// Whether an address is one on the network a ledger currency settles on (USDT_TRON → TRON).
// A currency on no known network has no valid address.
export const isValidAddressFor = (currency: string, address: unknown): boolean => {
  switch (networkFor(currency)) {
    case 'TRON': return isValidTronAddress(address)
    case 'SOL': return isValidSolanaAddress(address)
    default: return false
  }
}
