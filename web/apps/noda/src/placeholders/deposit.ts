// The Deposit screen's content as the Figma mockup shows it. None of it is real data yet.
import type { Status } from './transactions'

export const currency = {
  name: 'Bitcoin (BTC)',
  network: 'Bitcoin Network',
  notes: ['Send only BTC to this address', 'Minimum deposit: 0.0001 BTC', '12 network confirmations required'],
  address: '1AFKQ720MADLANKA-2w2eKFKJ9022',
}

export interface Deposit {
  currency: string
  amount: string
  usd: string
  status: Status
  time: string
}

export const deposits: Deposit[] = [
  { currency: 'BTC',  amount: '0.05432', usd: '$2,456.80', status: 'Completed', time: '2 hours ago' },
  { currency: 'ETH',  amount: '1.2500',  usd: '$3,125.00', status: 'Pending',   time: '5 hours ago' },
  { currency: 'USDT', amount: '5000.00', usd: '$5,000.00', status: 'Completed', time: '1 day ago' },
  { currency: 'SOL',  amount: '0.05432', usd: '$2,456.80', status: 'Completed', time: '2 days ago' },
]
