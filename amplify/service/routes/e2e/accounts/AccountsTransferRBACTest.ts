import axios from 'axios'

const API_URL = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/accounts/transfer'

async function callTransfer(accessToken: string) {
  const res = await axios.post(
    API_URL,
    {
      provider: 'PCF0001',
      senderAccountId: '69082f6e1a9794c78f868330',
      recipientAccountId: '690c2049b32e1bdb41d8cf78',
      amount: '120.30',
    },
    {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'X-Project': 'none',
      },
      validateStatus: () => true, // don't throw on 4xx/5xx
    }
  )

  return { status: res.status, body: res.data }
}

async function run() {
  // you can generate a user JWT with the "user" group using this:
  // aws cognito-idp admin-initiate-auth \
  // --user-pool-id us-east-2_gA5gSrESU \
  // --client-id 7obulbngpncbuqi169ktefjfg0 \
  // --auth-flow ADMIN_USER_PASSWORD_AUTH \
  // --auth-parameters USERNAME=teodoro641@gmail.com,PASSWORD=iwonttell \
  // --region us-east-2 \
  // --query 'AuthenticationResult.AccessToken' \
  // --output text
  // change the values for username and passowork

  const token = "<USER_ACCESS_TOKEN_here>"
  if (!token) {
    console.error('Missing USER_ACCESS_TOKEN env var. See instructions at the top of this file.')
    process.exit(1)
  }

  console.log('--- RBAC Test: /accounts/transfer ---')
  console.log('Calling /accounts/transfer with user-group JWT...')

  const { status, body } = await callTransfer(token)

  console.log(`Response status : ${status}`)
  console.log(`Response body   :`, body)

  if (status === 403) {
    console.log('user role correctly blocked from admin-only route')
  } else {
    console.log('expected 403 but got', status)
  }
}

run().catch(console.error)
