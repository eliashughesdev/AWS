import Stripe from 'stripe';
import { PaymentProcessor, PaymentParams, PaymentResult } from './PaymentProcessor';

export class StripePaymentProcessor implements PaymentProcessor {
  private stripe: Stripe;

  constructor(apiKey: string, apiBase: string) {
    this.stripe = new Stripe(apiKey, { host: apiBase });
    console.log("=======================", apiKey)
  }

  async processPayment(params: PaymentParams): Promise<PaymentResult> {
    try {
      console.log('Processing payment with params:', JSON.stringify(params, null, 2));

      // Parse the Evervault card data
      const cardData = params.cardData.card;
      console.log('Raw card data:', JSON.stringify(cardData, null, 2));

      if (!cardData.expiry || typeof cardData.expiry !== 'object' || !cardData.expiry.month || !cardData.expiry.year) {
        console.error('Invalid expiry format:', cardData.expiry);
        return {
          success: false,
          error: 'Invalid card expiry format',
        };
      }

      const exp_month = parseInt(cardData.expiry.month, 10);
      const exp_year = 2000 + parseInt(cardData.expiry.year, 10);
      console.log('Parsed expiry:', { exp_month, exp_year });

      const cardPayload = {
        number: cardData.number,
        exp_month: exp_month,
        exp_year,
        cvc: cardData.cvc,
      };
      console.log('Card payload for Stripe:', JSON.stringify(cardPayload, null, 2));

      console.log('Creating payment intent with inline card data...');
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: params.amount,
        currency: params.currency,
        payment_method_data: {
          type: 'card',
          card: {
            number: cardData.number,
            exp_month: exp_month,
            exp_year: exp_year,
            cvc: cardData.cvc,
          },
        },
        confirm: true,
      });
      console.log('Payment intent created:', paymentIntent.id);

      return {
        success: true,
        transactionId: paymentIntent.id,
      };
    } catch (error: any) {
      console.error('Stripe payment processing error:', error);
      console.error('Error details:', error.stack);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}