import { accountFor, callAsUser, run } from '../userSession'

// Charges the test user's first saved card into their USDT_TRON account. The account and
// the card are read from /accounts/list and /payments/list
run(async () => {
  const accountNumber = await accountFor('USDT_TRON')
  const cards = await callAsUser('/payments/list')
  const paymentId = cards.data?.res?.[0]?.id
  if (!paymentId) throw new Error(`The test user has no saved card (/payments/list answered ${cards.status})`)

  const { status, data } = await callAsUser('/accounts/deposit', {
    accountNumber,
    currency: 'USD', // the fiat charged
    amount: 50.00, // charged on the card
    paymentId,
  })
  console.log(status, data)
})

// Expected response:
// {
//   success: true,
//   jobId: '...',
//   transactionId: 'dep_...',
//   status: 'queued',
//   message: 'Deposit is being processed'
// }
