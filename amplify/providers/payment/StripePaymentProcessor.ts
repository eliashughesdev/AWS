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
          "Content-Type": "application/x-www-form-urlencoded"
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

      const stripeResponse = paymentResult.result || paymentResult;

      console.log('StripePaymentProcessor: Stripe response:', JSON.stringify(stripeResponse));

      // Check if the Stripe response itself contains an error
      if (stripeResponse.error) {
        console.error('StripePaymentProcessor: Stripe API error:', stripeResponse.error.message);
        return {
          success: false,
          error: stripeResponse.error.message || 'Stripe API error',
          status: 'error',
          retryable: true,
          metadata: {
            stripeError: stripeResponse.error
          }
        };
      }

      if (!stripeResponse.id) {
        console.error('StripePaymentProcessor: No PaymentIntent ID in Stripe response');
        return {
          success: false,
          error: 'No PaymentIntent ID returned from Stripe',
          status: 'failed',
          retryable: true
        };
      }

      console.log('StripePaymentProcessor: PaymentIntent created:', stripeResponse.id);
      console.log('StripePaymentProcessor: PaymentIntent status:', stripeResponse.status);

      // Map Stripe-specific responses to generic PaymentResult
      if (stripeResponse.status === 'requires_action' &&
          stripeResponse.next_action?.type === 'redirect_to_url') {
        // 3DS authentication required
        console.log('StripePaymentProcessor: 3DS authentication required');
        return {
          success: true,
          transactionId: stripeResponse.id,
          status: 'requires_action',
          metadata: {
            requiresAction: true,
            paymentIntentId: stripeResponse.id,
            authenticationUrl: stripeResponse.next_action.redirect_to_url.url,
            clientSecret: stripeResponse.client_secret,
            stripeStatus: stripeResponse.status
          }
        };
      } else if (stripeResponse.status === 'succeeded') {
        // Payment succeeded
        console.log('StripePaymentProcessor: Payment succeeded');
        return {
          success: true,
          transactionId: stripeResponse.id,
          status: 'succeeded',
          metadata: {
            amount: stripeResponse.amount,
            currency: stripeResponse.currency,
            stripeStatus: stripeResponse.status
          }
        };
      } else if (stripeResponse.status === 'requires_payment_method') {
        // Card was declined
        console.log('StripePaymentProcessor: Payment failed - card declined');
        return {
          success: false,
          error: 'Card declined',
          status: 'declined',
          retryable: false,
          metadata: {
            stripeStatus: stripeResponse.status
          }
        };
      } else {
        // Other unexpected status
        console.log('StripePaymentProcessor: Unexpected payment status:', stripeResponse.status);
        return {
          success: false,
          error: `Unexpected payment status: ${stripeResponse.status}`,
          status: 'unknown',
          retryable: true,
          metadata: {
            stripeStatus: stripeResponse.status
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