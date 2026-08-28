import { useState } from 'react'
import { useEvervault } from '@evervault/react'
import axios from 'axios'
import { fetchAuthSession } from 'aws-amplify/auth'
import { RELAY_BASE } from '../config'

interface AddCardProps {
  user: any;
}

export default function AddCard({ user }: AddCardProps) {
  const evervault = useEvervault()
  const [cardNumber, setCardNumber] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvc, setCvc] = useState('')

  const handleSave = async () => {
    if (!cardNumber || !expiry || !cvc) {
      alert('Please fill all fields')
      return
    }

    const [month, year] = expiry.split('/')
    if (!month || !year || month.length !== 2 || year.length !== 2) {
      alert('Invalid expiry format. Use MM/YY')
      return
    }

    if (!evervault) {
      alert('Encryption service not available')
      return
    }

    const cleanCardNumber = cardNumber.replace(/\s/g, '')
    const lastFour = cleanCardNumber.slice(-4)
    const bin = cleanCardNumber.slice(0, 8)
    const cardType = detectCardType(cleanCardNumber)

    // const cardData = {
    //   number: cardNumber,
    //   cvc: cvc,
    //   expiry: {
    //     month: month,
    //     year: year
    //   }
    // };

    try {
      // console.log("Starting encryption...");
      // const encryptedCardData = await evervault.encrypt(
      //   JSON.stringify(
      //     {
      //       number: cardNumber,
      //       cvc: cvc,
      //       expiry: {
      //         month: month,
      //         year: year
      //       }
      //     }));
      // console.log("Encryption successful");

      const session = await fetchAuthSession()
      const token = session.tokens?.accessToken?.toString()

      console.log('Sending request to backend...')
      const response = await axios.post(`${RELAY_BASE}/payments/save`, {
        paymentMethod: {
          lastFour,
          bin,
          cardType,
          cardData: JSON.stringify(
            {
              number: cardNumber,
              cvc,
              expiry: {
                month,
                year
              }
            })
        },
        userId: user.username,
      }, {
        headers: {
          'X-Project': 'e2e-hmac',
          Authorization: `Bearer ${token}`,
        },
      })

      console.log('Payment saved:', response.data)
      alert('Payment method saved successfully!')
    } catch (error: any) {
      console.error('Error saving payment:', error)
      alert('Failed to save payment method: ' + (error?.message || 'Unknown error'))
    }
  }

  // Helper function to detect card type
  function detectCardType(number: string): string {
    const patterns = {
      visa: /^4/,
      mastercard: /^5[1-5]/,
      amex: /^3[47]/,
      discover: /^6(?:011|5)/,
    }

    for (const [type, pattern] of Object.entries(patterns)) {
      if (pattern.test(number)) {
        return type
      }
    }
    return 'unknown'
  };

  return (
    <div>
      <h2>Add Card</h2>
      <div>
        <label>Card Number:</label>
        <input
          type='text'
          value={cardNumber}
          onChange={(e) => setCardNumber(e.target.value)}
          placeholder='1234 5678 9012 3456'
        />
      </div>
      <div>
        <label>Expiration Date (MM/YY):</label>
        <input
          type='text'
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          placeholder='12/25'
        />
      </div>
      <div>
        <label>CVC:</label>
        <input
          type='text'
          value={cvc}
          onChange={(e) => setCvc(e.target.value)}
          placeholder='123'
        />
      </div>
      <button onClick={handleSave}>
        Save
      </button>
    </div>
  )
}
