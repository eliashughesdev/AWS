import Stripe from 'stripe';
import { PaymentProcessor, PaymentParams, PaymentResult } from './PaymentProcessor';

export class StripePaymentProcessor implements PaymentProcessor {
  private stripe: Stripe;

  constructor(apiKey: string, apiBase: string) {
    this.stripe = new Stripe(apiKey, { host: apiBase });
  }

  async processPayment(params: PaymentParams): Promise<PaymentResult> {
    try {
      // Parse the Evervault card data
      const cardData = params.cardData.card;
      const [exp_month, exp_year_str] = cardData.expiry.split('/');
      const exp_year = 2000 + parseInt(exp_year_str, 10);

      // Create payment method with the parsed card data
      const paymentMethod = await this.stripe.paymentMethods.create({
        type: 'card',
        card: {
          number: cardData.number,
          exp_month: parseInt(exp_month, 10),
          exp_year,
          cvc: cardData.cvc,
        },
      });

      // Create and confirm payment intent
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: params.amount,
        currency: params.currency,
        payment_method: paymentMethod.id,
        confirm: true,
        automatic_payment_methods: { enabled: false },
      });

      return {
        success: true,
        transactionId: paymentIntent.id,
      };
    } catch (error: any) {
      console.error('Stripe payment processing error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}