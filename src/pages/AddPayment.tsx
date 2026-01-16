import { Card, themes } from "@evervault/react";
import { useState } from "react";
import axios from "axios";

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
      const response = await axios.post('/payments/save', {
        cardData: cardData,
        userId: user.username,
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