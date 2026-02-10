import Evervault from '@evervault/sdk';
import { PaymentProcessor, PaymentParams, PaymentResult, PaymentProcessorConfig } from './PaymentProcessor';

export class StripePaymentProcessor implements PaymentProcessor {
  private stripeApiKey: string;
  private evervault: Evervault;

  private constructor(stripeApiKey: string, evervaultAppId: string, evervaultApiKey: string) {
    this.stripeApiKey = stripeApiKey;
    this.evervault = new Evervault(evervaultAppId, evervaultApiKey);
    console.log("StripePaymentProcessor initialized");
  }

  // Static factory method - this is what the factory calls
  static create(config: PaymentProcessorConfig): StripePaymentProcessor {
    const stripeApiKey = config.stripeApiKey;

    if (!stripeApiKey) {
      throw new Error('StripePaymentProcessor requires stripeApiKey in config');
    }

    return new StripePaymentProcessor(
      stripeApiKey,
      config.evervaultAppId,
      config.evervaultApiKey
    );
  }

  async processPayment(params: PaymentParams): Promise<PaymentResult> {
    try {
      console.log('StripePaymentProcessor: Processing payment with params:', JSON.stringify(params, null, 2));

      // Use provided returnUrl or default to staging URL
      const returnUrl = params.metadata?.returnUrl || 'https://my.staging.loudibly.com/';

      // Build the Stripe API request with placeholders
      const stripeRequest = {
        url: "https://api.stripe.com/v1/payment_intents",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.stripeApiKey}`,
          "Content-Type": "application/json"
        },
        body: {
          amount: params.amount.toString(),
          currency: params.currency,
          "payment_method_data[type]": "card",
          "payment_method_data[card][number]": "{{CARD_NUMBER}}",
          "payment_method_data[card][exp_month]": "{{EXP_MONTH}}",
          "payment_method_data[card][exp_year]": "{{EXP_YEAR}}",
          "payment_method_data[card][cvc]": "{{CVC}}",
          // Enable 3DS
          "payment_method_options[card][request_three_d_secure]": "automatic",
          return_url: returnUrl,
          confirm: "true",
          capture_method: "automatic"
        }
      };

      console.log('StripePaymentProcessor: Encrypting proxy request configuration...');
      const encryptedProxy = await this.evervault.encrypt(JSON.stringify(stripeRequest));
      console.log('StripePaymentProcessor: Proxy request encrypted.');

      console.log('StripePaymentProcessor: Running Evervault payment-proxy function...');
      const paymentResult = await this.evervault.run('payments', {
        proxy: encryptedProxy,
        card_data: params.cardData
      });

      console.log('StripePaymentProcessor: Evervault function executed. Result:', JSON.stringify(paymentResult));

      if (!paymentResult || !paymentResult.id) {
        console.error('StripePaymentProcessor: Payment processing failed:', paymentResult);
        return {
          success: false,
          error: `Payment processing failed: ${JSON.stringify(paymentResult)}`,
          status: 'failed',
          retryable: true
        };
      }

      console.log('StripePaymentProcessor: PaymentIntent created:', paymentResult.id);
      console.log('StripePaymentProcessor: PaymentIntent status:', paymentResult.status);

      // Map Stripe-specific responses to generic PaymentResult
      if (paymentResult.status === 'requires_action' &&
          paymentResult.next_action?.type === 'redirect_to_url') {
        // 3DS authentication required
        console.log('StripePaymentProcessor: 3DS authentication required');
        return {
          success: true,
          transactionId: paymentResult.id,
          status: 'requires_action',
          metadata: {
            requiresAction: true,
            paymentIntentId: paymentResult.id,
            authenticationUrl: paymentResult.next_action.redirect_to_url.url,
            clientSecret: paymentResult.client_secret,
            stripeStatus: paymentResult.status
          }
        };
      } else if (paymentResult.status === 'succeeded') {
        // Payment succeeded
        console.log('StripePaymentProcessor: Payment succeeded');
        return {
          success: true,
          transactionId: paymentResult.id,
          status: 'succeeded',
          metadata: {
            amount: paymentResult.amount,
            currency: paymentResult.currency,
            stripeStatus: paymentResult.status
          }
        };
      } else if (paymentResult.status === 'requires_payment_method') {
        // Card was declined
        console.log('StripePaymentProcessor: Payment failed - card declined');
        return {
          success: false,
          error: 'Card declined',
          status: 'declined',
          retryable: false,
          metadata: {
            stripeStatus: paymentResult.status
          }
        };
      } else {
        // Other unexpected status
        console.log('StripePaymentProcessor: Unexpected payment status:', paymentResult.status);
        return {
          success: false,
          error: `Unexpected payment status: ${paymentResult.status}`,
          status: 'unknown',
          retryable: true,
          metadata: {
            stripeStatus: paymentResult.status
          }
        };
      }

    } catch (error: any) {
      console.error('StripePaymentProcessor: Payment processing error:', error);
      console.error('StripePaymentProcessor: Error details:', error.stack);
      return {
        success: false,
        error: error.message,
        status: 'error',
        retryable: true
      };
    }
  }
}