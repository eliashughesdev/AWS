import { Card, themes } from "@evervault/react";

const theme = themes.clean();

export default function AddPayment() {
  const handleChange = (details: any) => {
    console.log("Card details:", details);
    // Here you can handle the card details, e.g., send to backend
  };

  return (
    <div>
      <h2>Add Payment Method</h2>
      <Card theme={theme} onChange={handleChange} />
    </div>
  );
}