import type { Chain } from './types'
import { deriveSolanaAddress, generateSolanaWallet } from './solana'
import { deriveTronAddress, generateTronWallet } from './tron'

// Throws when the key is not a valid one for that chain.
export function deriveAddress(chain: Chain, privateKey: string): string {
  return chain === 'SOL' ? deriveSolanaAddress(privateKey) : deriveTronAddress(privateKey)
}

export async function generateWallet(chain: Chain): Promise<{ address: string; privateKey: string }> {
  const wallet = chain === 'SOL' ? generateSolanaWallet() : await generateTronWallet()
  return { address: wallet.address, privateKey: wallet.privateKey }
}
