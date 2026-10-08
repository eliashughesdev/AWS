// The Earn screen's content as the Figma mockup shows it. None of it is real data yet.
import { btc, eth, usdt, type CoinArt } from '../coins'
import type { Summary } from './transactions'

export const summary: Summary[] = [
  { label: 'Total Earnings', value: '$12,456.80', change: '+23.5%',  dot: 'teal', up: true },
  { label: 'Active Stakes',  value: '5',          change: '$45,230', dot: 'yellow' },
  { label: 'This Month',     value: '$1,234.50',  change: '+18.2%',  dot: 'green', up: true },
  { label: 'Est. APY',       value: '12.5%',      change: 'Average', dot: 'red' },
]

export interface Plan {
  name: string
  description: string
  apy: string
  lock: string
  minimum: string
  currency: string
  features: string[]
  recommended?: boolean
}

// The mockup gives the first two plans the same APY.
export const plans: Plan[] = [
  { name: 'Flexible Staking', description: 'Withdraw anytime with no penalties',         apy: '3.5%',  lock: 'None',     minimum: '0.001', currency: 'BTC',  features: ['No lock period', 'Daily rewards', 'Instant withdraw'] },
  { name: 'Standard Staking', description: 'Balanced returns with moderate lock period', apy: '3.5%',  lock: '30 days',  minimum: '0.1',   currency: 'ETH',  features: ['30-day lock', 'Weekly payouts', 'Auto-compound'], recommended: true },
  { name: 'High Yield',       description: 'Maximum returns for long-term holders',      apy: '15.0%', lock: '90 days',  minimum: '1000',  currency: 'USDT', features: ['90-day lock', 'Bi-weekly payouts', 'Bonus rewards'] },
  { name: 'Premium Staking',  description: 'Exclusive high-yield staking program',       apy: '20.0%', lock: '180 days', minimum: '10',    currency: 'BNB',  features: ['180-day lock', 'Monthly payouts', 'VIP benefits'] },
]

export interface Stake {
  coin: CoinArt
  amount: string
  usd: string
  apy: string
  earned: string
  duration: string
  unlock: string
}

export const stakes: Stake[] = [
  { coin: btc,  amount: '0.5432 BTC',   usd: '$24,560.80', apy: '3.5%',  earned: '$128.45', duration: '45 days', unlock: 'Anytime' },
  { coin: eth,  amount: '12.5000 ETH',  usd: '$36,566.25', apy: '8.5%',  earned: '$892.34', duration: '15 days', unlock: '2024-11-20' },
  { coin: usdt, amount: '5000.00 USDT', usd: '$5,000.00',  apy: '15.0%', earned: '$156.25', duration: '25 days', unlock: '2024-12-30' },
]

export const rewards = [
  { currency: 'BTC', amount: '0.00045', usd: '$20.34', type: 'Daily Reward',     date: '2024-11-05' },
  { currency: 'ETH', amount: '0.0234',  usd: '$68.45', type: 'Weekly Payout',    date: '2024-11-04' },
  { currency: 'SOL', amount: '12.50',   usd: '$12.50', type: 'Bi-weekly Payout', date: '2024-11-03' },
]
