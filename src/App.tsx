import { Amplify } from 'aws-amplify'
import { Authenticator } from '@aws-amplify/ui-react'
import outputs from '../amplify_outputs.json'
import CustomerKyc from './pages/CustomerKyc'
import '@aws-amplify/ui-react/styles.css'

Amplify.configure(outputs)

function App() {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/'

  return (
    <Authenticator>
      {({ signOut, user }) => {
        if (path === '/customer/kyc/') {
          return <CustomerKyc />
        }

        return (
          <main>
            <div>
              <h1>Hello {user?.username}!</h1>
              <p>🥳 App successfully hosted.</p>
              <a href="/customer/kyc">Open KYC</a>
              <br />
              <button onClick={signOut}>Sign out</button>
            </div>
          </main>
        )
      }}
    </Authenticator>
  )
}

export default App