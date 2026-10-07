// The Transactions screen's content as the Figma mockup shows it. None of it is real data yet.
import type { Dot } from '../tones'

export interface Summary {
  label: string
  value: string
  change: string
  up?: boolean  // which way the arrow beside the change points; no arrow when left out
  dot: Dot
}

export const summary: Summary[] = [
  { label: 'Total Volume', value: '$125,456.80', change: '+12.5%', up: true,  dot: 'teal' },
  { label: 'Incoming',     value: '$89,234.50',  change: '+18.2%', up: true,  dot: 'yellow' },
  { label: 'Outgoing',     value: '$36,222.30',  change: '+18.2%', up: false, dot: 'green' },
  { label: 'Transactions', value: '1,247',       change: '+18.2%', up: true,  dot: 'orange' },
]

export type TransactionType = 'Deposit' | 'Withdraw' | 'Convert' | 'Earn' | 'Payment' | 'Reward'
export type Status = 'Completed' | 'Pending'

export interface Transaction {
  id: string
  type: TransactionType
  currency: string
  amount: string
  up: boolean
  usd: string
  from: string
  to: string
  fee: string
  status: Status
  date: string
}

// The mockup repeats the second id on every later row.
export const transactions: Transaction[] = [
  { id: 'TXN-2024110501', type: 'Deposit',  currency: 'BTC',  amount: '+5000.00', up: true,  usd: '$24,560.80', from: 'External Wallet', to: 'Noda Wallet',     fee: '0.0001 BTC', status: 'Completed', date: '2024-11-05 14:32' },
  { id: 'TXN-2024110502', type: 'Withdraw', currency: 'ETH',  amount: '-2.5000',  up: false, usd: '$24,560.80', from: 'Noda Wallet',     to: 'External Wallet', fee: '0.005 ETH',  status: 'Pending',   date: '2024-11-04 09:15' },
  { id: 'TXN-2024110502', type: 'Convert',  currency: 'USDT', amount: '+5000.00', up: true,  usd: '$5,000.00',  from: 'BTC',             to: 'USDT',            fee: '$5.00',      status: 'Completed', date: '2024-11-03 16:20' },
  { id: 'TXN-2024110502', type: 'Earn',     currency: 'BNB',  amount: '+18.2%',   up: true,  usd: '$24,560.80', from: 'Noda Wallet',     to: 'AWS Services',    fee: '0.01 BNB',   status: 'Completed', date: '2024-11-02 11:45' },
  { id: 'TXN-2024110502', type: 'Payment',  currency: 'USD',  amount: '-125.00',  up: false, usd: '$125.00',    from: 'Noda Wallet',     to: 'Staking Pool',    fee: '0.01 BNB',   status: 'Completed', date: '2024-11-02 11:45' },
  { id: 'TXN-2024110502', type: 'Reward',   currency: 'ETH',  amount: '+12.50',   up: true,  usd: '$12.50',     from: 'Binance',         to: 'Noda Wallet',     fee: '0.01 BNB',   status: 'Completed', date: '2024-11-02 11:45' },
  { id: 'TXN-2024110502', type: 'Convert',  currency: 'BTC',  amount: '+45.2341', up: true,  usd: '$14,286.85', from: 'Staking Pool',    to: 'Noda Wallet',     fee: '0.01 BNB',   status: 'Completed', date: '2024-11-02 11:45' },
]
