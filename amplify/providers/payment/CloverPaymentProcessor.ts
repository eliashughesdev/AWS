import Evervault from '@evervault/sdk';
import { PaymentProcessor, PaymentParams, PaymentResult, PaymentProcessorConfig } from './PaymentProcessor';

export class CloverPaymentProcessor implements PaymentProcessor {
  private cloverPrivateToken: string;
  private cloverPublicKey: string;
  private evervault: Evervault;
  private readonly baseUrl = 'https://scl-sandbox.dev.clover.com';

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
    const creds = params.storedCredentials;

    // Recurring off-session charge using stored Clover Customer ID
    if (params.offSession && creds?.customerId) {
      return this.processRecurringPayment(params);
    }

    // First-time H2H charge
    return this.processFirstTimePayment(params);
  }

  /**
   * Recurring charge using a stored Clover Customer ID.
   * Clover automatically uses the card saved against that customer.
   * stored_credentials SUBSEQUENT is required for card-network MIT compliance.
   */
  private async processRecurringPayment(params: PaymentParams): Promise<PaymentResult> {
    const { customerId } = params.storedCredentials!;

    try {
      console.log('CloverPaymentProcessor: Processing recurring payment for customer:', customerId);

      const chargeBody = {
        ecomind: 'ecom',
        amount: params.amount,
        currency: 'usd',
        capture: true,
        source: customerId,
        external_reference_id: `payment_${Date.now()}`.slice(0, 12),
        stored_credentials: {
          sequence: 'SUBSEQUENT',
          initiator: 'MERCHANT',
          is_scheduled: true,
        },
      };

      const chargeResult = await this.cloverPost('/v1/charges', chargeBody, params.metadata?.clientIp);
      console.log('CloverPaymentProcessor: Recurring charge result:', JSON.stringify(chargeResult));

      return this.mapCloverResponse(chargeResult);

    } catch (error: any) {
      console.error('CloverPaymentProcessor: Recurring payment error:', error);
      return {
        success: false,
        error: error.message,
        status: 'error',
        retryable: true
      };
    }
  }

  /**
   * First-time H2H charge — three steps:
   * 1. Tokenize card via Evervault → single-use CLV token (card data never touches our server)
   * 2. Create a Clover Customer with that token as source → customerId
   *    Clover automatically vaults the card and links it to the customer.
   * 3. Charge using the customerId as source (no stored_credentials needed for first charge)
   *
   * Returns credentialsToSave: { customerId } in metadata
   * so paymentHandler can persist it for future recurring charges.
   */
  private async processFirstTimePayment(params: PaymentParams): Promise<PaymentResult> {
    try {
      console.log('CloverPaymentProcessor: Processing first-time payment');

      // Step 1: Tokenize via Evervault (only step where raw card data is in play)
      const singleUseToken = await this.tokenizeCard(params.cardData);
      console.log('CloverPaymentProcessor: Card tokenized');

      // Step 2: Create Customer — automatically vaults the card
      const customerId = await this.createCustomerWithCard(singleUseToken);
      console.log('CloverPaymentProcessor: Customer created:', customerId);

      // Step 3: Charge using the customer ID as source
      const chargeBody = {
        amount: params.amount,
        currency: 'usd',
        capture: true,
        source: customerId,
        external_reference_id: `payment_${Date.now()}`.slice(0, 12),
      };

      const chargeResult = await this.cloverPost('/v1/charges', chargeBody, params.metadata?.clientIp);
      console.log('CloverPaymentProcessor: First-time charge result:', JSON.stringify(chargeResult));

      // On success, save customerId so future recurring charges skip tokenization entirely
      const credentialsToSave = chargeResult.paid ? { customerId } : undefined;

      return this.mapCloverResponse(chargeResult, credentialsToSave);

    } catch (error: any) {
      console.error('CloverPaymentProcessor: First-time payment error:', error);
      return {
        success: false,
        error: error.message,
        status: 'error',
        retryable: true
      };
    }
  }

  /**
   * Tokenizes a card via Clover's tokenization API using the Evervault proxy.
   * This is the only step where raw card data is in play.
   */
  private async tokenizeCard(encryptedCardData: any): Promise<string> {
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

    // Evervault may wrap the response under .result; normalise both shapes
    const token = tokenResult.result?.id || tokenResult.id;
    if (!token) {
      throw new Error('Clover tokenization did not return a token');
    }

    return token;
  }

  /**
   * Creates a Clover Customer with the card token as source.
   * Clover automatically vaults the card and links it — no separate vaulting call needed.
   */
  private async createCustomerWithCard(singleUseToken: string): Promise<string> {
    const response = await this.cloverPost('/v1/customers', { source: singleUseToken });

    if (!response.id) {
      throw new Error(`Clover customer creation failed: ${JSON.stringify(response)}`);
    }

    return response.id;
  }

  /**
   * Generic POST helper for Clover's REST API.
   * Used for customer creation and all charges (no card data involved).
   */
  private async cloverPost(path: string, body: Record<string, any>, clientIp?: string): Promise<any> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.cloverPrivateToken}`,
        'Content-Type': 'application/json',
        'X-Forwarded-For': clientIp || '127.0.0.1',
      },
      body: JSON.stringify(body),
    });

    const result = await response.json() as any;
    console.log(`CloverPaymentProcessor: POST ${path} →`, JSON.stringify(result));
    return result;
  }

  /**
   * Maps a Clover charge response to a generic PaymentResult.
   * credentialsToSave is only set on successful first-time charges.
   */
  private mapCloverResponse(chargeResult: any, credentialsToSave?: Record<string, any>): PaymentResult {
    if (chargeResult.failure_code || chargeResult.error) {
      const isDecline = chargeResult.failure_code === 'card_declined'
        || chargeResult.failure_code === 'processing_error'
        || chargeResult.failure_code === 'insufficient_funds';

      return {
        success: false,
        error: chargeResult.error?.message || chargeResult.failure_message || 'Charge failed',
        status: isDecline ? 'declined' : 'failed',
        retryable: !isDecline,
        metadata: { cloverError: chargeResult.error }
      };
    }

    if (chargeResult.paid) {
      return {
        success: true,
        transactionId: chargeResult.id,
        status: 'succeeded',
        metadata: {
          cloverChargeId: chargeResult.id,
          last4: chargeResult.source?.last4,
          brand: chargeResult.source?.brand,
          captured: chargeResult.captured,
          credentialsToSave,
        }
      };
    }

    return {
      success: false,
      error: chargeResult.failure_message || 'Charge was not successful',
      status: 'failed',
      retryable: false,
      metadata: {
        cloverChargeId: chargeResult.id,
        cloverStatus: chargeResult.status
      }
    };
  }
}
