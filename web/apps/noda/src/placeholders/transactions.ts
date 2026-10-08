// What the Transactions screen still takes from the Figma mockup. Its rows and totals are real.
import type { Dot } from '../tones'

export interface Summary {
  label: string
  value: string
  change: string
  up?: boolean  // which way the arrow beside the change points; no arrow when left out
  dot: Dot
}

// The four cards, with the mockup's change line under each total: nothing keeps a history to
// work a change out from.
export const summary: Omit<Summary, 'value'>[] = [
  { label: 'Total Volume', change: '+12.5%', up: true,  dot: 'teal' },
  { label: 'Incoming',     change: '+18.2%', up: true,  dot: 'yellow' },
  { label: 'Outgoing',     change: '+18.2%', up: false, dot: 'green' },
  { label: 'Transactions', change: '+18.2%', up: true,  dot: 'orange' },
]

export type Status = 'Completed' | 'Pending'

// The Fee column: the backend does not say what a transaction cost yet, so a row shows the
// mockup's number for its type, in its own coin.
export const fees: Record<string, string> = {
  Deposit:  '0.0001',
  Withdraw: '0.005',
  Transfer: '0.01',
}
