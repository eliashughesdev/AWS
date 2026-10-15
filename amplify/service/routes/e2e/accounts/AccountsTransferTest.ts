import { accountsFor, callAsUser, run } from '../userSession'

// Moves 1 TRX between two of the test user's TRON accounts (open a second one first).
// E2E_TRANSFER_TO sends it to any other TRON account instead
run(async () => {
  const [sender, ownRecipient] = await accountsFor('TRON')
  const recipient = process.env.E2E_TRANSFER_TO ?? ownRecipient
  if (!sender || !recipient) throw new Error('The test user needs two TRON accounts, or set E2E_TRANSFER_TO')

  const { status, data } = await callAsUser('/accounts/transfer', {
    provider: 'PCF0001',
    senderAccountNumber: sender,
    recipientAccountNumber: recipient,
    amount: '1',
  })
  console.log(status, data)
})

// 200 { success: true, res: { data: { transactionId: '<ledger reference>' } } }
