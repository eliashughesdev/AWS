// What the Withdraw screen still takes from the Figma mockup. The accounts, their balances, the
// withdrawal itself and the history are real.

// The backend quotes no fee: a TRX or SOL withdrawal's fee is charged after it was sent, and a USDT
// one has none. The number is shown in the chosen account's coin.
export const fee = '0.0023'

// Nothing in the backend sets a limit or a minimum. The numbers are shown in the chosen account's
// coin. The mockup fills 49% of the bar, though 1.75 of 5.0 is 35%.
export const limits = {
  daily: '5.0',
  used: '1.75',
  usedShare: 49,
  minimum: '0.001',
  processing: '5-15 minutes',
}
