import Evervault from '@evervault/sdk';
import { PaymentProcessor, PaymentParams, PaymentResult, PaymentProcessorConfig } from './PaymentProcessor';

export class CloverPaymentProcessor implements PaymentProcessor {
  private cloverPrivateToken: string;
  private cloverPublicKey: string;
  private evervault: Evervault;

  private constructor(cloverPrivateToken: string, cloverPublicKey: string, evervaultAppId: string, evervaultApiKey: string) {
    this.cloverPrivateToken = cloverPrivateToken;
    this.cloverPublicKey = cloverPublicKey;
    this.evervault = new Evervault(evervaultAppId, evervaultApiKey);
    console.log("CloverPaymentProcessor initialized");
  }

  static create(config: PaymentProcessorConfig): CloverPaymentProcessor {
    const { cloverPrivateToken, cloverPublicKey } = config;

    if (!cloverPrivateToken || !cloverPublicKey) {
      throw new Error('CloverPaymentProcessor requires cloverPrivateToken and cloverPublicKey');
    }

    return new CloverPaymentProcessor(
      cloverPrivateToken,
      cloverPublicKey,
      config.evervaultAppId,
      config.evervaultApiKey
    );
  }

  async processPayment(params: PaymentParams): Promise<PaymentResult> {
    try {
      console.log('CloverPaymentProcessor: Processing payment');

      // Step 1: Tokenize card
      const cloverToken = await this.tokenizeCard(params.cardData);
      console.log('CloverPaymentProcessor: Card tokenized');

      // Step 2: Create charge with token
      const chargeResult = await this.createCharge(cloverToken, params);
      console.log('CloverPaymentProcessor: Charge created');

      return chargeResult;

    } catch (error: any) {
      console.error('CloverPaymentProcessor error:', error);
      return {
        success: false,
        error: error.message,
        status: 'error'
      };
    }
  }

  /**
   * Step 1: Tokenize card using Clover's tokenization API
   */
  private async tokenizeCard(encryptedCardData: any): Promise<string> {
    // Build tokenization request
    const tokenizeRequest = {
      url: "https://token-sandbox.dev.clover.com/v1/tokens",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": this.cloverPublicKey
      },
      body: {
        card: {
          number: "{{CARD_NUMBER}}",
          exp_month: "{{EXP_MONTH}}",
          exp_year: "{{EXP_YEAR}}",
          cvv: "{{CVC}}"
        }
      }
    };

    const encryptedProxy = await this.evervault.encrypt(JSON.stringify(tokenizeRequest));

    const tokenResult = await this.evervault.run('payments', {
      proxy: encryptedProxy,
      card_data: encryptedCardData
    });

    console.log('CloverPaymentProcessor: Tokenization result:', JSON.stringify(tokenResult));

    if (tokenResult.error) {
      throw new Error(`Clover tokenization failed: ${tokenResult.error.message || tokenResult.error}`);
    }

    if (!tokenResult.id) {
      throw new Error('Clover tokenization did not return a token');
    }

    return tokenResult.result.id;
  }

  /**
   * Step 2: Create charge using the token
   */
  private async createCharge(cloverToken: string, params: PaymentParams): Promise<PaymentResult> {
    // Build charge request
    const chargeRequest = {
      url: "https://scl-sandbox.dev.clover.com/v1/charges",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.cloverPrivateToken}`,
        "Content-Type": "application/json",
        "X-Forwarded-For": params.metadata?.clientIp || "127.0.0.1"
      },
      body: {
        amount: params.amount,
        // currency: params.currency.toLowerCase(),
        currency: 'usd',
        source: cloverToken,
        capture: true,
        external_reference_id: `payment_${Date.now()}`.slice(0,12)
      }
    };

    const encryptedProxy = await this.evervault.encrypt(JSON.stringify(chargeRequest));

    // Create empty card_data, empty becaues a token was creted previousyl
    const emptyCardData = await this.evervault.encrypt(JSON.stringify({ cardData: JSON.stringify({}) }));

    const chargeResult = await this.evervault.run('payments', {
      proxy: encryptedProxy,
      card_data: emptyCardData
    });

    if (chargeResult.failure_code) {
      return {
        success: false,
        error: chargeResult.error.message || 'Charge failed',
        status: 'failed',
        metadata: {
          cloverError: chargeResult.error
        }
      };
    }

    // Check if charge succeeded
    if (chargeResult.paid) {
      return {
        success: true,
        transactionId: chargeResult.id,
        status: 'succeeded',
        metadata: {
          cloverChargeId: chargeResult.id,
          last4: chargeResult.source?.last4,
          brand: chargeResult.source?.brand,
          captured: chargeResult.captured
        }
      };
    } else {
      return {
        success: false,
        error: chargeResult.failure_message || 'Charge was not successful',
        status: 'failed',
        metadata: {
          cloverChargeId: chargeResult.id,
          cloverStatus: chargeResult.status
        }
      };
    }
  }
}
