// The Accounts screen's content as the Figma mockup shows it. None of it is real data yet.
export interface Account {
  name: string
  main?: boolean
  status: string
  balance: string
  address: string
  holdings: string[]
}

const address = '0×7a9f...3d2c0×7a9f...3d2c0×7a9f...3d2c'

export const accounts: Account[] = [
  { name: 'Main Wallet',     main: true, status: 'Active', balance: '$12,580.50', address, holdings: ['BTC', 'ETH', 'SOL', 'NOD'] },
  { name: 'Trading Account',             status: 'Active', balance: '$3,540.80',  address, holdings: ['BTC', 'ETH'] },
  { name: 'Business Wallet',             status: 'Active', balance: '$1,960.50',  address, holdings: ['BTC', 'SOL'] },
  { name: 'Savings',                     status: 'Active', balance: '$2,320.10',  address, holdings: ['BTC', 'SOL'] },
]
