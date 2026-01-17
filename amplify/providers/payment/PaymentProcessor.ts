export interface PaymentParams {
  amount: number;
  currency: string;
  cardData: any;
  userId: string;
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

export interface PaymentProcessor {
  processPayment(params: PaymentParams): Promise<PaymentResult>;
}