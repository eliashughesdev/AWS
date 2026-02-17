export interface PaymentParams {
  amount: number;
  currency: string;
  cardData?: string;
  userId: string;
  offSession?: boolean;
  stripeCustomerId?: string;
  stripePaymentMethodId?: string;
  metadata?: Record<string, any>;
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  error?: string;
  status?: string;
  retryable?: boolean;
  metadata?: Record<string, any>;
}

export interface PaymentProcessorConfig {
  evervaultAppId: string;
  evervaultApiKey: string;
  [key: string]: any;
}

export interface PaymentProcessor {
  processPayment(params: PaymentParams): Promise<PaymentResult>;
}

// Static factory method that each processor must implement
export interface PaymentProcessorConstructor {
  new (config: PaymentProcessorConfig): PaymentProcessor;
  create(config: PaymentProcessorConfig): PaymentProcessor;
}