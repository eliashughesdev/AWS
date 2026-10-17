// The parts of the Dashboard that still show what the Figma mockup shows. None of it is real
// data: replace each export as the backend gains something to put there.

// The line under the total, which is real.
export const portfolio = {
  change: '+40.9%',
  changeAmount: '(+$13 892,45)',
  period: 'Last 30 days',
}

export const security = {
  level: 'Excellent',
  note: '85% - Enable 2FA for better security',
}

// The rows above "KYC Verified", which is real.
export const achievements = ['First Deposit', '5+ Transactions', 'Staking Active']

export interface Change {
  text: string
  up: boolean
}

// An asset row's % change, by coin symbol. USDT's is the mockup's; TRX and SOL take those of
// its first two rows (BTC and ETH). A coin with none shows nothing.
export const changes: Record<string, Change> = {
  TRX:  { text: '+40.9%', up: true },
  SOL:  { text: '-2.1%',  up: false },
  USDT: { text: '+1%',    up: true },
}

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
