// What the staff merchants page and its register dialog both show.

// USDT_TRON and TUSDT_TRON are Tatum ledger currencies, not names; TRON and SOL read fine as they are.
export const currencyLabel = (currency: string) =>
  currency === 'USDT_TRON' || currency === 'TUSDT_TRON' ? 'USDT (TRON)' : currency

const green = 'bg-green-400/10 text-green-400 border-green-400/20'
const amber = 'bg-amber-400/10 text-amber-400 border-amber-400/20'
const red   = 'bg-red-400/10 text-red-400 border-red-400/20'
const grey  = 'bg-white/5 text-text-secondary border-border-subtle'

// A merchant is `active`. A currency in the list is `ready` or `provisioning`; in the
// answer to a registration it is `ready`, `failed` or `pending`, and so is each seed.
const pills: Record<string, { label: string; tone: string }> = {
  active:       { label: 'Active',        tone: green },
  ready:        { label: 'Ready',         tone: green },
  provisioning: { label: 'Not finished',  tone: amber },
  pending:      { label: 'Still running', tone: amber },
  failed:       { label: 'Failed',        tone: red   },
}

export const statusPill = (status: string) => pills[status] ?? { label: status, tone: grey }
