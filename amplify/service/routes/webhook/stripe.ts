import Stripe from 'stripe'
import { response } from '../../../utils/http'
import {
	findAttemptByProviderRef,
	updateAttemptStatus,
	updateOrderStatus,
} from '../../../utils/paymentLogger'
import { notifyPaymentResult } from '../../../utils/websocket'
import { queryRecord } from '../../../utils/db'

export default class StripeWebhookHandler {
	async execute(event: any) {
		const rawBody = event.rawBody
		const signature = event.headers?.['stripe-signature'] || event.headers?.['Stripe-Signature']

		if (!signature) {
			return response({
				statusCode: 400,
				headers: null,
				bodyObject: { error: 'Missing stripe-signature header' },
			})
		}

		const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
		if (!webhookSecret) {
			console.error('STRIPE_WEBHOOK_SECRET environment variable not set')
			return response({
				statusCode: 500,
				headers: null,
				bodyObject: { error: 'Webhook not configured' },
			})
		}

		let stripeEvent: Stripe.Event
		try {
			const stripe = new Stripe(process.env.STRIPE_API_KEY || '')
			stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
		} catch (err: any) {
			console.error('Stripe webhook signature verification failed:', err.message)
			return response({
				statusCode: 400,
				headers: null,
				bodyObject: { error: 'Invalid signature' },
			})
		}

		console.log(`Stripe webhook received: ${stripeEvent.type}, id: ${stripeEvent.id}`)

		switch (stripeEvent.type) {
			case 'payment_intent.succeeded':
				await this.handlePaymentIntentSucceeded(stripeEvent.data.object as Stripe.PaymentIntent)
				break
			case 'payment_intent.payment_failed':
				await this.handlePaymentIntentFailed(stripeEvent.data.object as Stripe.PaymentIntent)
				break
			default:
				console.log(`Unhandled Stripe event type: ${stripeEvent.type}`)
		}

		// Always return 200 to acknowledge receipt
		return response({
			statusCode: 200,
			headers: null,
			bodyObject: { received: true },
		})
	}

	private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
		console.log(`PaymentIntent succeeded: ${paymentIntent.id}`)

		const attemptRecord = await this.findAttemptRecord(paymentIntent.id)
		if (!attemptRecord) return

		const { paymentOrderId, attemptNumber, provider } = attemptRecord

		await updateAttemptStatus({
			paymentOrderId,
			attemptNumber,
			provider,
			status: 'succeeded',
			providerRef: paymentIntent.id,
			providerMetadata: {
				stripeStatus: paymentIntent.status,
				amount: paymentIntent.amount,
				currency: paymentIntent.currency,
				webhookEventType: 'payment_intent.succeeded',
			},
		})

		await updateOrderStatus({
			paymentOrderId,
			finalStatus: 'succeeded',
			finalProvider: provider,
			providerRef: paymentIntent.id,
			totalAttempts: attemptNumber,
		})

		await this.notifyUser(paymentOrderId, {
			success: true,
			status: 'succeeded',
			paymentTransactionId: paymentIntent.id,
		})
	}

	private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
		console.log(`PaymentIntent failed: ${paymentIntent.id}`)

		const attemptRecord = await this.findAttemptRecord(paymentIntent.id)
		if (!attemptRecord) return

		const { paymentOrderId, attemptNumber, provider } = attemptRecord
		const errorMessage = paymentIntent.last_payment_error?.message || 'Payment failed after 3DS'

		await updateAttemptStatus({
			paymentOrderId,
			attemptNumber,
			provider,
			status: 'failed',
			providerRef: paymentIntent.id,
			errorMessage,
			providerMetadata: {
				stripeStatus: paymentIntent.status,
				stripeError: paymentIntent.last_payment_error,
				webhookEventType: 'payment_intent.payment_failed',
			},
		})

		await updateOrderStatus({
			paymentOrderId,
			finalStatus: 'failed',
			finalProvider: provider,
			providerRef: paymentIntent.id,
			totalAttempts: attemptNumber,
		})

		await this.notifyUser(paymentOrderId, {
			success: false,
			status: 'failed',
			error: errorMessage,
		})
	}

	private async findAttemptRecord(paymentIntentId: string) {
		const lookupResult = await findAttemptByProviderRef(paymentIntentId)
		if (!lookupResult.success || !lookupResult.res || lookupResult.res.length === 0) {
			console.warn(`No attempt record found for PaymentIntent ${paymentIntentId}`)
			return null
		}

		const record = lookupResult.res.find((r: any) => r.sk.startsWith('ATTEMPT#'))
		if (!record) {
			console.warn(`No ATTEMPT record found for PaymentIntent ${paymentIntentId}`)
			return null
		}

		// Parse attemptNumber and provider from sk (format: ATTEMPT#<num>#<provider>)
		const skParts = record.sk.split('#')
		return {
			paymentOrderId: record.id,
			attemptNumber: parseInt(skParts[1], 10),
			provider: skParts[2],
		}
	}

	private async notifyUser(paymentOrderId: string, result: {
		success: boolean
		status?: string
		error?: string
		paymentTransactionId?: string
	}) {
		const orderRecords = await queryRecord(
			'v1PaymentTransactionLogsTable',
			'id = :id AND sk = :sk',
			{ ':id': paymentOrderId, ':sk': 'ORDER#META' }
		)

		if (!orderRecords.success || !orderRecords.res || orderRecords.res.length === 0) {
			console.warn(`No ORDER#META found for paymentOrderId ${paymentOrderId}, skipping WebSocket notification`)
			return
		}

		const order = orderRecords.res[0]
		await notifyPaymentResult(
			order.clientTransactionId,
			order.userId,
			result,
			order.paymentId
		)
	}
}
