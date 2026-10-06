// Icons cut from the Figma export as alpha masks at 2x (the design has no SVG sources).
// w and h are CSS pixels, the size each icon has in the design.
import dashboard from './assets/icons/dashboard.png'
import accounts from './assets/icons/accounts.png'
import deposit from './assets/icons/deposit.png'
import withdraw from './assets/icons/withdraw.png'
import convert from './assets/icons/convert.png'
import payments from './assets/icons/payments.png'
import earn from './assets/icons/earn.png'
import transactions from './assets/icons/transactions.png'
import translate from './assets/icons/translate.png'
import chevronDown from './assets/icons/chevron-down.png'
import sun from './assets/icons/sun.png'
import moon from './assets/icons/moon.png'
import bell from './assets/icons/bell.png'
import settings from './assets/icons/settings.png'

export const icons = {
  dashboard:      { src: dashboard,    w: 22, h: 19 },
  accounts:       { src: accounts,     w: 20, h: 18 },
  deposit:        { src: deposit,      w: 22, h: 14 },
  withdraw:       { src: withdraw,     w: 21, h: 19 },
  convert:        { src: convert,      w: 17, h: 17 },
  payments:       { src: payments,     w: 22, h: 17 },
  earn:           { src: earn,         w: 21, h: 21 },
  transactions:   { src: transactions, w: 19, h: 15 },
  translate:      { src: translate,    w: 13, h: 13 },
  'chevron-down': { src: chevronDown,  w:  7, h:  4 },
  sun:            { src: sun,          w: 14, h: 14 },
  moon:           { src: moon,         w: 13, h: 13 },
  bell:           { src: bell,         w: 16, h: 16 },
  settings:       { src: settings,     w: 16, h: 17 },
}

export type IconName = keyof typeof icons
