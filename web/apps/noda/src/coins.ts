// What the UI shows for each currency an account can hold (the backend's `chain`).
import { USDT_TRON_CURRENCY } from '@loudibly/core/config'
import sol from './assets/coins/sol.png'
import trx from './assets/coins/trx.png'
import usdt from './assets/coins/usdt.png'

export interface Coin {
  symbol: string
  name: string
  image: string
  network?: string  // a token's network; a network's own coin has none
}

const tether: Coin = { symbol: 'USDT', name: 'Tether', image: usdt, network: 'TRON' }

const coins: Record<string, Coin> = {
  TRON:       { symbol: 'TRX', name: 'TRON',   image: trx },
  SOL:        { symbol: 'SOL', name: 'Solana', image: sol },
  USDT_TRON:  tether,
  TUSDT_TRON: tether,  // the testnet stand-in
}

// A currency the catalogue does not know shows its own code and no image.
export const coinFor = (chain: string): Coin => coins[chain] ?? { symbol: chain, name: chain, image: '' }

// The network a currency is sent over, as Deposit names it. The build says whether that is the test
// network, in the variables core reads for the same thing. Not in Figma: the test networks' names
// and the token standard.
const tron   = import.meta.env.VITE_TRON_NETWORK === 'mainnet' ? 'TRON Network' : 'TRON Shasta Testnet'
const solana = import.meta.env.VITE_SOLANA_NETWORK === 'mainnet' ? 'Solana Network' : 'Solana Devnet'

const networks: Record<string, string> = {
  TRON:       tron,
  SOL:        solana,
  USDT_TRON:  `${tron} (TRC-20)`,
  TUSDT_TRON: `${tron} (TRC-20)`,
}

export const networkName = (chain: string) => networks[chain] ?? '—'

// The currencies a new account can be opened in.
export const newAccountChains = ['TRON', 'SOL', USDT_TRON_CURRENCY]
