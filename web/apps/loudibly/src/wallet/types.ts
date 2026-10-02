export type Chain = 'TRON' | 'SOL'

export const CHAINS: Chain[] = ['TRON', 'SOL']

export const chainLabels: Record<Chain, string> = { TRON: 'TRON', SOL: 'Solana' }

// Normalized on-chain transaction. `amount` is signed: negative = outgoing from
// the watched address. Mirrors the backend OnChainTransaction shape.
export interface OnChainTx {
  txId: string
  amount: number
  currency: string
  from?: string
  to?: string
  blockNumber?: number
  timestamp?: number
}
