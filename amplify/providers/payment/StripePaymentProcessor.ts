import Stripe from 'stripe';
import { PaymentProcessor, PaymentParams, PaymentResult } from './PaymentProcessor';

export class StripePaymentProcessor implements PaymentProcessor {
  private stripe: Stripe;

  constructor(apiBase: string) {
    this.stripe = new Stripe(process.env.STRIPE_API_KEY!, { host: apiBase });
  }

  async processPayment(params: PaymentParams): Promise<PaymentResult> {
    try {
      // Create payment method with the Evervault-encrypted card data
      const paymentMethod = await this.stripe.paymentMethods.create({
        type: 'card',
        card: params.cardData.card,
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