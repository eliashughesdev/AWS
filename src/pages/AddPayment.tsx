import { Card, themes } from "@evervault/react";
import { useState } from "react";
import axios from "axios";
import { fetchAuthSession } from 'aws-amplify/auth';

const theme = themes.clean();

interface AddPaymentProps {
  user: any;
}

export default function AddPayment({ user }: AddPaymentProps) {
  const [cardData, setCardData] = useState<any>(null);

  const handleChange = (details: any) => {
    console.log("Card details:", details);
    setCardData(details);
  };

  const handleSave = async () => {
    if (!cardData || !cardData.isComplete) {
      alert("Please complete the card details");
      return;
    }

    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.accessToken?.toString();

      const response = await axios.post('https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/payments/save', {
        cardData: cardData,
        userId: user.username,
        bin: cardData.card?.bin,
        lastFour: cardData.card?.lastFour,
      }, {
        headers: {
          'X-Project': 'e2e-hmac',
          Authorization: `Bearer ${token}`,
        },
      });
      console.log("Payment saved:", response.data);
      alert("Payment method saved successfully!");
    } catch (error) {
      console.error("Error saving payment:", error);
      alert("Failed to save payment method");
    }
  };

  return (
    <div>
      <h2>Add Payment Method</h2>
      <Card theme={theme} onChange={handleChange} />
      <button onClick={handleSave} disabled={!cardData || !cardData.isComplete}>
        Save
      </button>
    </div>
  );
}