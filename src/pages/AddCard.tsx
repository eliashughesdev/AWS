import { useState } from "react";
import { useEvervault } from "@evervault/react";
import axios from "axios";
import { fetchAuthSession } from 'aws-amplify/auth';

interface AddCardProps {
  user: any;
}

export default function AddCard({ user }: AddCardProps) {
  const evervault = useEvervault();
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");

  const handleSave = async () => {
    if (!cardNumber || !expiry || !cvc) {
      alert("Please fill all fields");
      return;
    }

    // Parse expiry MM/YY
    const [month, year] = expiry.split('/');
    if (!month || !year || month.length !== 2 || year.length !== 2) {
      alert("Invalid expiry format. Use MM/YY");
      return;
    }

    if (!evervault) {
      alert("Encryption service not available");
      return;
    }

    const lastFour = cardNumber.slice(-4);

    const paymentMethod = {
      id: crypto.randomUUID(),
      number: cardNumber,
      cvc: cvc,
      lastFour: lastFour,
      expiry: {
        month: month,
        year: year
      }
    };

    try {
      console.log("Starting encryption...");
      console.log("Evervault object:", evervault);
      const encryptedData = await evervault.encrypt(paymentMethod);
      console.log("Encryption successful");

      const session = await fetchAuthSession();
      const token = session.tokens?.accessToken?.toString();

      console.log("Sending request to backend...");
      const response = await axios.post('https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/payments/save', {
        paymentMethod: encryptedData,
        userId: user.username,
      }, {
        headers: {
          'X-Project': 'e2e-hmac',
          Authorization: `Bearer ${token}`,
        },
      });
      console.log("Payment saved:", response.data);
      alert("Payment method saved successfully!");
    } catch (error: any) {
      console.error("Error saving payment:", error);
      if (error && error.message) {
        console.error("Error message:", error.message);
      }
      alert("Failed to save payment method: " + (error?.message || "Unknown error"));
    }
  };

  return (
    <div>
      <h2>Add Card</h2>
      <div>
        <label>Card Number:</label>
        <input
          type="text"
          value={cardNumber}
          onChange={(e) => setCardNumber(e.target.value)}
          placeholder="1234 5678 9012 3456"
        />
      </div>
      <div>
        <label>Expiration Date (MM/YY):</label>
        <input
          type="text"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          placeholder="12/25"
        />
      </div>
      <div>
        <label>CVC:</label>
        <input
          type="text"
          value={cvc}
          onChange={(e) => setCvc(e.target.value)}
          placeholder="123"
        />
      </div>
      <button onClick={handleSave}>
        Save
      </button>
    </div>
  );
}