// The Dashboard's content as the Figma mockup shows it. None of it is real data yet:
// replace each export as the screen gets wired to the backend.
import type { IconName } from '../icons'
import type { Tone } from '../tones'
import btc from '../assets/coins/btc.png'
import eth from '../assets/coins/eth.png'
import usdt from '../assets/coins/usdt.png'
import noda from '../assets/coins/noda.png'

export const portfolio = {
  balance: '$125,456.80',
  change: '+40.9%',
  changeAmount: '(+$13 892,45)',
  period: 'Last 30 days',
}

export const security = {
  level: 'Excellent',
  note: '85% - Enable 2FA for better security',
}

export const achievements = [
  { label: 'First Deposit',   done: true },
  { label: '5+ Transactions', done: true },
  { label: 'Staking Active',  done: true },
  { label: 'KYC Verified',    done: false },
]

export interface Asset {
  symbol: string
  name: string
  coin: string
  amount: string
  value: string
  change: string
  up: boolean
  share: number  // % of the portfolio
}

export const assetCount = '5 Assets'

export const assets: Asset[] = [
  { symbol: 'BTC',  name: 'Bitcoin',  coin: btc,  amount: '2.45671 BTC',  value: '$111,026.47', change: '+40.9%', up: true,  share: 45 },
  { symbol: 'ETH',  name: 'Ethereum', coin: eth,  amount: '2.45671 ETH',  value: '$111,026.47', change: '-2.1%',  up: false, share: 22 },
  { symbol: 'USDT', name: 'Tether',   coin: usdt, amount: '2.45671 USDT', value: '$111,026.47', change: '+1%',    up: true,  share: 10 },
  { symbol: 'NODA', name: '',         coin: noda, amount: '2.45671 NOD',  value: '$111,026.47', change: '+45%',   up: true,  share: 65 },
]

export interface Stat {
  label: string
  value: string
  change: string
}

export const stats: Stat[] = [
  { label: 'Total Profit',   value: '$23,456.80', change: '+ 12.4%' },
  { label: 'Best Performer', value: 'SOL',        change: '+ 8.4%' },
  { label: 'Active Stakes',  value: '5',          change: '+ 8.4%' },
  { label: '24h Volume',     value: '$89,234',    change: '+ 18.1%' },
]

export interface Activity {
  kind: string
  asset: string
  amount: string
  usd: string
  time: string
  status: string
  icon: IconName
  mobileIcon?: IconName
  tone: Tone
}

export const activity: Activity[] = [
  { kind: 'Deposit',  asset: 'BTC',        amount: '+0.5432', usd: '$24,560.80', time: '2 hours ago', status: 'Completed', icon: 'deposit',  tone: 'green' },
  { kind: 'Convert',  asset: 'ETH → USDT', amount: '5.0 ETH', usd: '$14,626.50', time: '5 hours ago', status: 'Completed', icon: 'convert',  mobileIcon: 'convert-sm',  tone: 'blue' },
  { kind: 'Withdraw', asset: 'BNB',        amount: '-10.2',   usd: '$3,221.36',  time: '5 hours ago', status: 'Completed', icon: 'withdraw', mobileIcon: 'withdraw-sm', tone: 'yellow' },
]
