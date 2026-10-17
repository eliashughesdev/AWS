import { accountFor, callAsUser, run } from '../userSession'

// One of the test user's accounts (E2E_ACCOUNT to name another). Another user's account answers
// 100001, as a missing one does
run(async () => {
  const accountNumber = process.env.E2E_ACCOUNT ?? await accountFor('TRON')
  const { status, data } = await callAsUser('/accounts/details', { accountNumber })
  console.log(status, JSON.stringify(data, null, 2))
})
