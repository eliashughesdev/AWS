import Stripe from 'stripe'
import Evervault from '@evervault/sdk'
import { PaymentProcessor, PaymentParams, PaymentResult, PaymentProcessorConfig } from './PaymentProcessor'

export class StripePaymentProcessor implements PaymentProcessor {
  private stripeApiKey: string
  private evervault: Evervault

  private constructor(stripeApiKey: string, evervaultAppId: string, evervaultApiKey: string) {
    this.stripeApiKey = stripeApiKey
    this.evervault = new Evervault(evervaultAppId, evervaultApiKey)
    console.log('StripePaymentProcessor initialized')
  }

  static create(config: PaymentProcessorConfig): StripePaymentProcessor {
    const stripeApiKey = config.stripeApiKey

    if (!stripeApiKey) {
      throw new Error('StripePaymentProcessor requires stripeApiKey in config')
    }

    return new StripePaymentProcessor(
      stripeApiKey,
      config.evervaultAppId,
      config.evervaultApiKey
    )
  }

  async processPayment(params: PaymentParams): Promise<PaymentResult> {
    const creds = params.storedCredentials

    // recurring off-session charge using stored Stripe credentials (customerId + paymentMethodId)
    if (params.offSession && creds?.customerId && creds?.paymentMethodId) {
      return this.processRecurringPayment(params)
    }

    // first-time H2H charge via Evervault proxy
    return this.processFirstTimePayment(params)
  }

  /**
   * Recurring charge — uses stored Stripe Customer + PaymentMethod.
   * No card data is transmitted; Stripe applies MIT exemption to skip 3DS in most cases.
   */
  private async processRecurringPayment(params: PaymentParams): Promise<PaymentResult> {
    const { customerId, paymentMethodId } = params.storedCredentials!

    try {
      console.log('StripePaymentProcessor: Processing recurring payment for customer:', customerId)

      const stripe = new Stripe(this.stripeApiKey)
      const paymentIntent = await stripe.paymentIntents.create({
        amount: params.amount,
        currency: params.currency,
        customer: customerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
      })

      console.log('StripePaymentProcessor: Recurring PI created:', paymentIntent.id, 'status:', paymentIntent.status)

      return this.mapStripeResponse(paymentIntent, { customerId, paymentMethodId })
    } catch (error: any) {
      // Stripe throws an error (not a response) when off_session requires 3DS
      if (error?.code === 'authentication_required') {
        const paymentIntentId = error.raw?.payment_intent?.id
        const clientSecret = error.raw?.payment_intent?.client_secret
        const authUrl = error.raw?.payment_intent?.next_action?.redirect_to_url?.url ||
          error.raw?.payment_intent?.next_source_action?.authorize_with_url?.url

        console.log('StripePaymentProcessor: Recurring charge requires 3DS authentication')
        return {
          success: true,
          transactionId: paymentIntentId,
          status: 'requires_action',
          metadata: {
            requiresAction: true,
            paymentIntentId,
            authenticationUrl: authUrl,
            clientSecret,
            stripeStatus: 'requires_action',
            credentialsToSave: { customerId, paymentMethodId },
          }
        }
      }

      console.error('StripePaymentProcessor: Recurring payment error:', error)
      return {
        success: false,
        error: error.message,
        status: 'error',
        retryable: true
      }
    }
  }

  /**
   * First-time H2H charge via Evervault proxy.
   * Adds setup_future_usage so Stripe creates a storable PaymentMethod.
   * After a successful or requires_action response, creates a Stripe Customer
   * and attaches the PaymentMethod — returned as credentialsToSave for the caller to persist.
   */
  private async processFirstTimePayment(params: PaymentParams): Promise<PaymentResult> {
    try {
      console.log('StripePaymentProcessor: Processing first-time payment')

      const returnUrl = params.metadata?.returnUrl || process.env.FRONTEND_URL
      if (!returnUrl) {
        console.error('StripePaymentProcessor: no returnUrl and FRONTEND_URL unset — cannot build a 3DS return URL')
        return { success: false, error: 'Payment configuration error', status: 'error', retryable: false }
      }

      const stripeRequest = {
        url: 'https://api.stripe.com/v1/payment_intents',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.stripeApiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: {
          amount: params.amount.toString(),
          currency: params.currency,
          'payment_method_data[type]': 'card',
          'payment_method_data[card][number]': '{{CARD_NUMBER}}',
          'payment_method_data[card][exp_month]': '{{EXP_MONTH}}',
          'payment_method_data[card][exp_year]': '{{EXP_YEAR}}',
          'payment_method_data[card][cvc]': '{{CVC}}',
          'payment_method_options[card][request_three_d_secure]': 'automatic',
          setup_future_usage: 'off_session',
          return_url: returnUrl,
          confirm: 'true',
          capture_method: 'automatic'
        }
      }

      console.log('StripePaymentProcessor: Encrypting proxy request configuration...')
      const encryptedProxy = await this.evervault.encrypt(JSON.stringify(stripeRequest))

      console.log('StripePaymentProcessor: Running Evervault payment-proxy function...')
      const paymentResult = await this.evervault.run('payments', {
        proxy: encryptedProxy,
        card_data: params.cardData
      })

      console.log('StripePaymentProcessor: Evervault function executed. Result:', JSON.stringify(paymentResult))

      if (!paymentResult || !paymentResult.id) {
        console.error('StripePaymentProcessor: Payment processing failed:', paymentResult)
        return {
          success: false,
          error: `Payment processing failed: ${JSON.stringify(paymentResult)}`,
          status: 'failed',
          retryable: true
        }
      }

      const stripeResponse = paymentResult.result || paymentResult

      console.log('StripePaymentProcessor: Stripe response:', JSON.stringify(stripeResponse))

      if (stripeResponse.error) {
        console.error('StripePaymentProcessor: Stripe API error:', stripeResponse.error.message)
        return {
          success: false,
          error: stripeResponse.error.message || 'Stripe API error',
          status: 'error',
          retryable: true,
          metadata: { stripeError: stripeResponse.error }
        }
      }

      if (!stripeResponse.id) {
        console.error('StripePaymentProcessor: No PaymentIntent ID in Stripe response')
        return {
          success: false,
          error: 'No PaymentIntent ID returned from Stripe',
          status: 'failed',
          retryable: true
        }
      }

      console.log('StripePaymentProcessor: PaymentIntent created:', stripeResponse.id, 'status:', stripeResponse.status)

      // The PI response includes payment_method when card data was submitted.
      // Create a Customer and attach the PM so future recurring charges need no card data.
      let credentialsToSave: Record<string, any> | undefined
      const pmId = stripeResponse.payment_method
      if (pmId) {
        try {
          const { customerId } = await this.setupStripeCredentials(pmId, params.userId)
          credentialsToSave = { customerId, paymentMethodId: pmId }
          console.log('StripePaymentProcessor: Stripe credentials ready to save — customer:', customerId)
        } catch (credErr: any) {
          // Non-fatal: first-time payment still succeeds even if credential setup fails
          console.error('StripePaymentProcessor: Failed to set up Stripe credentials:', credErr.message)
        }
      }

      return this.mapStripeResponse(stripeResponse, credentialsToSave)
    } catch (error: any) {
      console.error('StripePaymentProcessor: Payment processing error:', error)
      console.error('StripePaymentProcessor: Error details:', error.stack)
      return {
        success: false,
        error: error.message,
        status: 'error',
        retryable: true
      }
    }
  }

  /**
   * Creates a Stripe Customer and attaches the given PaymentMethod to it.
   */
  private async setupStripeCredentials(paymentMethodId: string, userId: string): Promise<{ customerId: string }> {
    const stripe = new Stripe(this.stripeApiKey)
    const customer = await stripe.customers.create({ metadata: { userId } })
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id })
    console.log('StripePaymentProcessor: Customer created and PM attached:', customer.id)
    return { customerId: customer.id }
  }

  /**
   * Maps a Stripe PaymentIntent object to a generic PaymentResult.
   * credentialsToSave is passed through opaquely — the caller (paymentHandler) persists it.
   */
  private mapStripeResponse(
    stripeResponse: any,
    credentialsToSave?: Record<string, any>
  ): PaymentResult {
    // docs says that when 3ds is required the api will return requires_action status
    // but it actually returns requires_source_action as a status... Weird.
    // so i am checking for both statuses just to be safe.
    const needs3DS = (stripeResponse.status === 'requires_action' && stripeResponse.next_action?.type === 'redirect_to_url') ||
      (stripeResponse.status === 'requires_source_action' && stripeResponse.next_source_action?.type === 'authorize_with_url')

    if (needs3DS) {
      const authenticationUrl = stripeResponse.next_action?.redirect_to_url?.url ||
        stripeResponse.next_source_action?.authorize_with_url?.url

      console.log('StripePaymentProcessor: 3DS authentication required, redirect URL:', authenticationUrl)
      return {
        success: true,
        transactionId: stripeResponse.id,
        status: 'requires_action',
        metadata: {
          requiresAction: true,
          paymentIntentId: stripeResponse.id,
          authenticationUrl,
          clientSecret: stripeResponse.client_secret,
          stripeStatus: stripeResponse.status,
          credentialsToSave,
        }
      }
    }

    if (stripeResponse.status === 'succeeded') {
      console.log('StripePaymentProcessor: Payment succeeded')
      return {
        success: true,
        transactionId: stripeResponse.id,
        status: 'succeeded',
        metadata: {
          amount: stripeResponse.amount,
          currency: stripeResponse.currency,
          stripeStatus: stripeResponse.status,
          credentialsToSave,
        }
      }
    }

    if (stripeResponse.status === 'requires_payment_method') {
      console.log('StripePaymentProcessor: Payment failed - card declined')
      return {
        success: false,
        error: 'Card declined',
        status: 'declined',
        retryable: false,
        metadata: { stripeStatus: stripeResponse.status }
      }
    }

    console.log('StripePaymentProcessor: Unexpected payment status:', stripeResponse.status)
    return {
      success: false,
      error: `Unexpected payment status: ${stripeResponse.status}`,
      status: 'unknown',
      retryable: true,
      metadata: { stripeStatus: stripeResponse.status }
    }
  }
}
