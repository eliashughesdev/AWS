// The user's crypto accounts as a list to choose from. Not in Figma: the design chooses a currency,
// but a user can hold two accounts in one. An entry is the coin as the design writes it, then the
// account's name. Coins go in the New Account dialog's order.
import type { Account } from '@loudibly/core/api/types'
import { coinFor, networkName, newAccountChains } from './coins'
import { placeholderName } from './placeholders/accountNames'

const coinOrder = newAccountChains.map(chain => coinFor(chain).symbol)
const rank = (symbol: string) => (coinOrder.indexOf(symbol) + 1) || coinOrder.length + 1

export function accountChoices(accounts: Account[]) {
  return accounts
    .map(account => {
      const coin = coinFor(account.chain)
      const name = placeholderName(account.accountNo)
      const title = coin.name === coin.symbol ? coin.symbol : `${coin.name} (${coin.symbol})`
      return {
        value:     account.accountNo,
        label:     `${title} · ${name}`,
        title,
        // An account still being imported, in the Accounts page's word.
        name:      account.status === 'importing' ? `${name} · Syncing` : name,
        chain:     account.chain,
        coin,
        symbol:    coin.symbol,
        network:   networkName(account.chain),
        // Every account opened today has one; a record from before may not.
        address:   account.depositAddress || '',
        balance:   account.balance,
        available: account.availableBalance,
      }
    })
    .sort((a, b) => rank(a.symbol) - rank(b.symbol) || a.name.localeCompare(b.name) || a.value.localeCompare(b.value))
}

export type AccountChoice = ReturnType<typeof accountChoices>[number]
