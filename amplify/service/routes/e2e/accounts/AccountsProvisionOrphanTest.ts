import { callAsUser, run } from '../userSession'

// B30: Tatum rejects the accounting currency, so provisioning fails at its
// first step. Expect a 400 with error_code 100002 and nothing left behind: no
// Tatum account, and no index used under the merchant's seed.
run(async () => {
  const { status, data } = await callAsUser('/accounts/account', {
    accountName: `B30 orphan check ${Date.now().toString()}`,
    chain: 'TRON',
    provider: 'PCF0001',
    accountingCurrency: 'NOT_A_CURRENCY',
  })
  console.log(status, data)
})
