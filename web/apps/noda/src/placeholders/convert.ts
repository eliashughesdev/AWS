// The Convert screen's content as the Figma mockup shows it. None of it is real data yet.
import btc from '../assets/coins/btc.png'
import eth from '../assets/coins/eth.png'
import usdt from '../assets/coins/usdt.png'
import noda from '../assets/coins/noda.png'
import sol from '../assets/coins/sol.png'

// The mockup shows the BTC balance under both amounts.
export const sides = [
  { label: 'From', amount: '1.0',   currency: 'BTC', balance: '2.45671 BTC', usd: '≈ $111 118,222' },
  { label: 'To',   amount: '15,45', currency: 'ETH', balance: '2.45671 BTC', usd: '≈ $55 356,622' },
]

export const quote = {
  rate: '1 BTC = 15.45 ETH',
  feeLabel: 'Fee (0.1%)',
  fee: '0.001 BTC',
  receive: '15.45 ETH',
}

export const rates = [
  { symbol: 'BTC',  name: 'Bitcoin',  coin: btc,  price: '$45 230,5', change: '+40.9%', up: true },
  { symbol: 'ETH',  name: 'Ethereum', coin: eth,  price: '$2 925,3',  change: '-1.2%',  up: false },
  { symbol: 'USDT', name: 'Tether',   coin: usdt, price: '$215.2',    change: '+5.9%',  up: true },
  { symbol: 'NODA', name: '',         coin: noda, price: '$315,8',    change: '+2.8%',  up: true },
  { symbol: 'SOL',  name: 'Solana',   coin: sol,  price: '$98,75',    change: '-1.2%',  up: false },
]

export const conversions = [
  { from: 'BTC',  to: 'ETH',  amount: '0.5',  received: '7.72',      rate: '15.45',    time: '2 hours ago' },
  { from: 'ETH',  to: 'USDT', amount: '4.0',  received: '14,626.50', rate: '2,925.30', time: '1 day ago' },
  { from: 'SOL',  to: 'BNB',  amount: '10.0', received: '0.0698',    rate: '0.00698',  time: '2 days ago' },
  { from: 'USDT', to: 'ETH',  amount: '3.0',  received: '237.1',     rate: '18,92',    time: '3 days ago' },
]
