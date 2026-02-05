import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { fetchAuthSession } from 'aws-amplify/auth';

interface ProcessPaymentProps {
  user: any;
}

interface PaymentMethod {
  id: string;
  lastFour: string;
  cardType: string;
}

export default function ProcessPayment({ user }: ProcessPaymentProps) {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<string>("USD");
  const [provider, setProvider] = useState<string>("stripe");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // WebSocket connection URL - will be loaded from amplify outputs
  const WS_URL = "wss://v4vqz0z2q4.execute-api.us-east-2.amazonaws.com/v1";

  useEffect(() => {
    // Load payment methods for the user
    loadPaymentMethods();

    return () => {
      // Cleanup WebSocket on unmount
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const loadPaymentMethods = async () => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.accessToken?.toString();

      const response = await axios.get(
        `https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/payments/list`,
        {
          headers: {
            'X-Project': 'e2e-hmac',
            Authorization: `Bearer ${token}`,
          },
          params: {
            userId: user.username,
          },
        }
      );

      if (response.data.success && response.data.res) {
        setPaymentMethods(response.data.res);
        if (response.data.res.length > 0) {
          setSelectedPaymentId(response.data.res[0].id);
        }
      }
    } catch (error) {
      console.error("Error loading payment methods:", error);
      setStatus("Failed to load payment methods");
    }
  };

  const connectWebSocket = (paymentId: string) => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(
        `${WS_URL}?userId=${encodeURIComponent(user.username)}&paymentId=${encodeURIComponent(paymentId)}`
      );

      ws.onopen = () => {
        console.log("WebSocket connected");
        setWsConnected(true);
        setStatus("Connected. Ready to process payment...");
        wsRef.current = ws;
        resolve();
      };

      ws.onmessage = (event) => {
        console.log("WebSocket message received:", event.data);
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'PAYMENT_RESULT') {
            const data = message.data;

            if (data.success) {
              setStatus(`Payment successful! Transaction ID: ${data.transactionId || 'N/A'}`);
              setLoading(false);
            } else {
              setStatus(`Payment failed: ${data.error || data.status}`);
              setLoading(false);
            }

            // Close WebSocket after receiving result
            setTimeout(() => {
              ws.close();
            }, 1000);
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setStatus("WebSocket connection error");
        setWsConnected(false);
        reject(error);
      };

      ws.onclose = () => {
        console.log("WebSocket disconnected");
        setWsConnected(false);
        wsRef.current = null;
      };
    });
  };

  const handlePayment = async () => {
    if (!selectedPaymentId) {
      alert("Please select a payment method");
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      alert("Please enter a valid amount");
      return;
    }

    setLoading(true);
    setStatus("Connecting...");

    try {
      // Generate a unique payment ID for this transaction
      const transactionPaymentId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Connect to WebSocket first
      await connectWebSocket(transactionPaymentId);

      // Get auth token
      const session = await fetchAuthSession();
      const token = session.tokens?.accessToken?.toString();

      setStatus("Processing payment...");

      // Queue the payment for processing
      const response = await axios.post(
        'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/payments/process',
        {
          paymentId: selectedPaymentId,
          userId: user.username,
          amount: parseFloat(amount),
          currency: currency,
          provider: provider,
          transactionId: transactionPaymentId,
        },
        {
          headers: {
            'X-Project': 'e2e-hmac',
            Authorization: `Bearer ${token}`,
          },
        }
      );

      console.log("Payment queued:", response.data);
      setStatus("Payment queued. Waiting for processing...");

    } catch (error: any) {
      console.error("Error processing payment:", error);
      setStatus(`Failed to process payment: ${error?.message || "Unknown error"}`);
      setLoading(false);

      // Close WebSocket on error
      if (wsRef.current) {
        wsRef.current.close();
      }
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: '50px auto', padding: '20px' }}>
      <h2>Process Payment</h2>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '5px' }}>Payment Method:</label>
        <select
          value={selectedPaymentId}
          onChange={(e) => setSelectedPaymentId(e.target.value)}
          style={{ width: '100%', padding: '8px', fontSize: '14px' }}
          disabled={loading}
        >
          <option value="">Select a payment method</option>
          {paymentMethods.map((pm) => (
            <option key={pm.id} value={pm.id}>
              {pm.cardType.toUpperCase()} ending in {pm.lastFour}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '5px' }}>Amount:</label>
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          style={{ width: '100%', padding: '8px', fontSize: '14px' }}
          disabled={loading}
        />
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '5px' }}>Currency:</label>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          style={{ width: '100%', padding: '8px', fontSize: '14px' }}
          disabled={loading}
        >
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
          <option value="GBP">GBP</option>
        </select>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '5px' }}>Payment Provider:</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          style={{ width: '100%', padding: '8px', fontSize: '14px' }}
          disabled={loading}
        >
          <option value="stripe">Stripe</option>
          <option value="clover">Clover</option>
        </select>
      </div>

      <button
        onClick={handlePayment}
        disabled={loading || !selectedPaymentId}
        style={{
          width: '100%',
          padding: '12px',
          fontSize: '16px',
          backgroundColor: loading ? '#ccc' : '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'Processing...' : 'Pay Now'}
      </button>

      {status && (
        <div style={{
          marginTop: '20px',
          padding: '12px',
          backgroundColor: status.includes('successful') ? '#d4edda' : status.includes('failed') ? '#f8d7da' : '#d1ecf1',
          border: `1px solid ${status.includes('successful') ? '#c3e6cb' : status.includes('failed') ? '#f5c6cb' : '#bee5eb'}`,
          borderRadius: '4px',
          color: status.includes('successful') ? '#155724' : status.includes('failed') ? '#721c24' : '#0c5460',
        }}>
          <strong>Status:</strong> {status}
          {wsConnected && <span style={{ marginLeft: '10px', color: 'green' }}>● Connected</span>}
        </div>
      )}

      <div style={{ marginTop: '20px' }}>
        <a href="/" style={{ color: '#007bff', textDecoration: 'none' }}>← Back to Home</a>
      </div>
    </div>
  );
}
