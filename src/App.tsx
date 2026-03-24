import { Amplify } from 'aws-amplify'
import { Authenticator } from '@aws-amplify/ui-react'
import outputs from '../amplify_outputs.json'
import CustomerKyc from './pages/CustomerKyc'
import KycComplete from './pages/KycComplete'
import '@aws-amplify/ui-react/styles.css'
import { EvervaultProvider } from '@evervault/react'
import AddCard from './pages/AddCard'
import ProcessPayment from './pages/ProcessPayment'
import PaymentWidget from './pages/PaymentWidget'

Amplify.configure(outputs)

function App() {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/'


  return (
    <EvervaultProvider teamId='team_8a2d3693584f' appId='app_322d8e2bc10b'>
      <Authenticator>
        {({ signOut, user }) => {
          if (path === '/customer/kyc/' || path === '/customer/kyc') {
            return <CustomerKyc />
          }
          if (path === '/customer/kyc/complete') {
            return <KycComplete />
          }
          if (path === '/payment/add') {
            return <AddCard user={user} />
          }
          if (path === '/payment/process') {
            return <ProcessPayment user={user} />
          }
          if (path === '/payment/widget') {
            return <PaymentWidget user={user} />
          }

          return (
            <main>
              <div>
                <h1>Hello {user?.username}!</h1>
                <p>🥳 App successfully hosted.</p>
                <a href='/customer/kyc'>Open KYC</a>
                <br />
                <a href='/payment/add'>Add Payment</a>
                <br />
                <a href='/payment/process'>Process Payment</a>
                <br />
                <button onClick={signOut}>Sign out</button>
              </div>
            </main>
          )
        }}
      </Authenticator>
    </EvervaultProvider>
  )
}

export default App
