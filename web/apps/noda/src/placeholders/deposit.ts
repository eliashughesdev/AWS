// What the Deposit screen still takes from the Figma mockup. The account, its address and the
// deposits are real.

// Two of the three lines in the "important" box. Nothing in the backend sets a minimum, and how many
// confirmations a deposit waits for is the ledger provider's business. The minimum is shown in the
// chosen account's coin.
export const rules = {
  minimum: '0.0001',
  confirmations: '12 network confirmations required',
}
