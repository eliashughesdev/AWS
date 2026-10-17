import { accountFor, callAsUser, run } from '../userSession'

// Sends 1 TRX from the test user's TRON account to a testnet address (E2E_WITHDRAW_TO to change it)
run(async () => {
  const accountNumber = await accountFor('TRON')
  const { status, data } = await callAsUser('/accounts/withdraw', {
    accountNumber,
    currency: 'TRON',
    cryptoAmount: 1,
    destinationAddress: process.env.E2E_WITHDRAW_TO ?? 'TBypofoy6CJaSY1VrcrUjgFzDCNer7iVLW',
  })
  console.log(status, data)
})

// Expected response:
// {
//   success: true,
//   jobId: '...',
//   transactionId: 'wdr_...',
//   status: 'queued',
//   message: 'Withdrawal is being processed',
//   res: { cryptoAmount: 1, cryptoCurrency: 'TRON', exchangeRate: 1 }
// }

// Error cases:
// { error_code: 100001, message: 'this account id does not exist or not active' }
// { error_code: 100007, message: 'insufficient balance for this withdrawal' }
