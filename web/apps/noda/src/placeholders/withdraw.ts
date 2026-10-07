// The Withdraw screens' content as the Figma mockup shows it. None of it is real data yet.
import type { Status } from './transactions'
import btc from '../assets/coins/btc.png'
import eth from '../assets/coins/eth.png'
import usdt from '../assets/coins/usdt.png'
import noda from '../assets/coins/noda.png'

export const currencies = ['ETH', 'BTC', 'USDT', 'SOL']

export const form = {
  currency: 'ETH',
  available: '2.45 ETH',
  fee: '0.0023 ETH',
  receive: '0.00 ETH',
}

export const wallets = [
  { symbol: 'BTC',  name: 'Bitcoin',  coin: btc,  amount: '2.45671 BTC' },
  { symbol: 'ETH',  name: 'Ethereum', coin: eth,  amount: '2.45671 ETH' },
  { symbol: 'USDT', name: 'Tether',   coin: usdt, amount: '2.45671 USDT' },
  { symbol: 'NODA', name: '',         coin: noda, amount: '2.45671 NOD' },
]

// The mockup fills 49% of the bar, though 1.75 of 5.0 is 35%.
export const limits = {
  daily: '5.0 ETH',
  used: '1.75 ETH used today',
  usedShare: 49,
  minimum: '0.001 ETH',
  processing: '5-15 minutes',
}

export interface Withdrawal {
  wallet: string
  amount: string
  currency: string
  status: Status
  date: string
  hash: string
}

export const withdrawals: Withdrawal[] = [
  { wallet: '0×7a9f...3d2c', amount: '5.0',   currency: 'ETH',  status: 'Completed', date: '2023-07-15 14:32', hash: '0×7a9f...3d2c' },
  { wallet: '0×7a9f...3d2c', amount: '500.0', currency: 'USDT', status: 'Pending',   date: '2023-07-15 14:32', hash: '0×7a9f...3d2c' },
  { wallet: '0×7a9f...3d2c', amount: '0.05',  currency: 'BTC',  status: 'Completed', date: '2023-07-15 14:32', hash: '0×7a9f...3d2c' },
  { wallet: '0×7a9f...3d2c', amount: '1.5',   currency: 'ETH',  status: 'Completed', date: '2023-07-15 14:32', hash: '0×7a9f...3d2c' },
]
