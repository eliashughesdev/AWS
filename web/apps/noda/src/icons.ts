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
import wallet from './assets/icons/wallet.png'
import refresh from './assets/icons/refresh.png'
import eye from './assets/icons/eye.png'
import arrowUp from './assets/icons/arrow-up.png'
import depositLg from './assets/icons/deposit-lg.png'
import shield from './assets/icons/shield.png'
import star from './assets/icons/star.png'
import trophy from './assets/icons/trophy.png'
import withdrawSm from './assets/icons/withdraw-sm.png'
import convertSm from './assets/icons/convert-sm.png'
import refreshSm from './assets/icons/refresh-sm.png'
import eyeSm from './assets/icons/eye-sm.png'

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
  wallet:         { src: wallet,       w: 22, h: 20 },
  refresh:        { src: refresh,      w: 22, h: 22 },
  eye:            { src: eye,          w: 27, h: 22 },
  'arrow-up':     { src: arrowUp,      w: 12, h: 14 },
  'deposit-lg':   { src: depositLg,    w: 27, h: 17 },
  shield:         { src: shield,       w: 18, h: 22 },
  star:           { src: star,         w: 18, h: 16 },
  trophy:         { src: trophy,       w: 26, h: 26 },
  // Cut from the mobile design, where these are drawn with heavier strokes.
  'withdraw-sm':  { src: withdrawSm,   w: 13, h: 12 },
  'convert-sm':   { src: convertSm,    w: 11, h: 11 },
  'refresh-sm':   { src: refreshSm,    w: 17, h: 17 },
  'eye-sm':       { src: eyeSm,        w: 18, h: 15 },
}

export type IconName = keyof typeof icons
