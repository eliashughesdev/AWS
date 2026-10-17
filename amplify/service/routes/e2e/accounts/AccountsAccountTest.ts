import { callAsUser, run } from '../userSession'

// Opens a USDT_TRON account for the signed-in test user (see ../userSession.ts)
run(async () => {
  const { status, data } = await callAsUser('/accounts/account', {
    accountName: `Account ${Date.now().toString()}`,
    chain: 'USDT_TRON',
    provider: 'PCF0001',
    accountingCurrency: 'USD',
  })
  console.log(status, data)
})

// 200 {
//   success: true,
//   res: { data: { id: '<the user\'s sub>', accountNo: 'PCF0001…', depositAddress: 'T…' } }
// }
