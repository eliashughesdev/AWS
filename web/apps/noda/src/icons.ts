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
import starFilled from './assets/icons/star-filled.png'
import copy from './assets/icons/copy.png'
import search from './assets/icons/search.png'
import filter from './assets/icons/filter.png'
import pulse from './assets/icons/pulse.png'
import calendar from './assets/icons/calendar.png'
import caret from './assets/icons/caret.png'
import arrowRight from './assets/icons/arrow-right.png'
import filterSm from './assets/icons/filter-sm.png'
import pulseSm from './assets/icons/pulse-sm.png'
import calendarSm from './assets/icons/calendar-sm.png'
import caretSm from './assets/icons/caret-sm.png'
import card from './assets/icons/card.png'
import bank from './assets/icons/bank.png'
import info from './assets/icons/info.png'
import swap from './assets/icons/swap.png'
import refreshLight from './assets/icons/refresh-light.png'
import bankLg from './assets/icons/bank-lg.png'
import applePay from './assets/icons/apple-pay.png'
import funnel from './assets/icons/funnel.png'
import check from './assets/icons/check.png'
import lock from './assets/icons/lock.png'
import percent from './assets/icons/percent.png'
import walletSm from './assets/icons/wallet-sm.png'
import cardSm from './assets/icons/card-sm.png'
import bankSm from './assets/icons/bank-sm.png'
import copyLight from './assets/icons/copy-light.png'
import copyLightSm from './assets/icons/copy-light-sm.png'

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
  'star-filled':  { src: starFilled,   w: 16, h: 15.5 },
  copy:           { src: copy,         w: 16, h: 16 },
  search:         { src: search,       w: 18, h: 18 },
  filter:         { src: filter,       w: 21, h: 21 },
  pulse:          { src: pulse,        w: 24, h: 16 },
  calendar:       { src: calendar,     w: 20, h: 21 },
  caret:          { src: caret,        w: 12.5, h: 6.5 },
  'arrow-right':  { src: arrowRight,   w:  9, h: 8.5 },
  card:           { src: card,         w: 21, h: 17 },
  bank:           { src: bank,         w: 18, h: 18 },
  info:           { src: info,         w: 18, h: 18 },
  'copy-light':   { src: copyLight,    w: 18, h: 18 },
  swap:           { src: swap,         w: 22, h: 20 },
  'refresh-light': { src: refreshLight, w: 16.5, h: 17 },
  'bank-lg':      { src: bankLg,       w: 19, h: 19 },
  'apple-pay':    { src: applePay,     w: 29, h: 12 },
  funnel:         { src: funnel,       w: 17, h: 17 },
  check:          { src: check,        w: 22, h: 22 },
  lock:           { src: lock,         w: 12, h: 13 },
  percent:        { src: percent,      w: 8.5, h: 9.5 },
  // Cut from the mobile design, where these are drawn with heavier strokes or at their own size.
  'withdraw-sm':  { src: withdrawSm,   w: 13, h: 12 },
  'convert-sm':   { src: convertSm,    w: 11, h: 11 },
  'refresh-sm':   { src: refreshSm,    w: 17, h: 17 },
  'eye-sm':       { src: eyeSm,        w: 18, h: 15 },
  'filter-sm':    { src: filterSm,     w: 15, h: 15 },
  'pulse-sm':     { src: pulseSm,      w: 21, h: 14 },
  'calendar-sm':  { src: calendarSm,   w: 16.5, h: 17 },
  'caret-sm':     { src: caretSm,      w:  9, h:  5 },
  'wallet-sm':    { src: walletSm,     w: 16.5, h: 15 },
  'card-sm':      { src: cardSm,       w: 16.5, h: 13.5 },
  'bank-sm':      { src: bankSm,       w: 15, h: 15 },
  'copy-light-sm': { src: copyLightSm, w: 16.5, h: 16 },
}

export type IconName = keyof typeof icons
