// The Payments screen's content as the Figma mockup shows it. None of it is real data yet.
import type { IconName } from '../icons'
import type { Status, Summary } from './transactions'

export const summary: Summary[] = [
  { label: 'Total Spent', value: '$603.06', change: '+40.9%',     dot: 'teal', up: true },
  { label: 'Pending',     value: '$87.50',  change: '1 payment',  dot: 'yellow' },
  { label: 'Completed',   value: '$515.56', change: '4 payments', dot: 'green' },
  { label: 'Failed',      value: '$78.90',  change: '1 payment',  dot: 'red' },
]

export interface Method {
  icon: IconName
  name: string
  kind: string
  primary?: boolean
}

export const methods: Method[] = [
  { icon: 'card',      name: 'Visa •••• 4242',       kind: 'Credit Card', primary: true },
  { icon: 'card',      name: 'Mastercard •••• 8888', kind: 'Credit Card' },
  { icon: 'bank-lg',   name: 'Chase Bank',           kind: 'Bank Account' },
  { icon: 'apple-pay', name: 'Apple Pay',            kind: 'Mobile Payment' },
]

export interface Payment {
  id: string
  recipient: string
  method: string
  number?: string  // a card's masked number, drawn under the method
  category: string
  amount: string
  status: Status
  date: string
}

// The mockup repeats the fourth id on every later row.
export const payments: Payment[] = [
  { id: 'PAY-001', recipient: 'Amazon Web Services',  method: 'Visa',       number: '•••• 4242', category: 'Services',      amount: '$125.00', status: 'Completed', date: '2024-11-05 14:32' },
  { id: 'PAY-002', recipient: 'Netflix Subscription', method: 'Mastercard', number: '•••• 8888', category: 'Entertainment', amount: '$15.99',  status: 'Pending',   date: '2024-11-04 09:15' },
  { id: 'PAY-003', recipient: 'Electric Company',     method: 'Chase Bank',                      category: 'Utilities',     amount: '$87.50',  status: 'Completed', date: '2024-11-03 16:20' },
  { id: 'PAY-004', recipient: 'Grocery Store',        method: 'Apple Pay',                       category: 'Shopping',      amount: '$243.67', status: 'Completed', date: '2024-11-02 11:45' },
  { id: 'PAY-004', recipient: 'Netflix Subscription', method: 'Mastercard', number: '•••• 8888', category: 'Shopping',      amount: '$243.67', status: 'Completed', date: '2024-11-02 11:45' },
  { id: 'PAY-004', recipient: 'Gas Station',          method: 'Visa',       number: '•••• 4242', category: 'Shopping',      amount: '$243.67', status: 'Completed', date: '2024-11-02 11:45' },
  { id: 'PAY-004', recipient: 'Restaurant',           method: 'Visa',       number: '•••• 4242', category: 'Shopping',      amount: '$243.67', status: 'Completed', date: '2024-11-02 11:45' },
]
