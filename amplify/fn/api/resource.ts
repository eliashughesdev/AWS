import { secret } from '@aws-amplify/backend'
import { defineFunction } from '@aws-amplify/backend'

export const mainApiFn = defineFunction({
	name: "main-api-fn",
	resourceGroupName: 'data',
	timeoutSeconds: 28,
	environment: {
		TATUM_API_KEY: secret('TATUM_API_KEY'),
		TATUM_KMS_BASE_URL: process.env.TATUM_KMS_BASE_URL || 'https://api.tatum.io/v3',
		EVERVAULT_API_KEY: secret('EVERVAULT_API_KEY'),
		STRIPE_API_KEY: secret('STRIPE_API_KEY'),
		STRIPE_WEBHOOK_SECRET: secret('STRIPE_WEBHOOK_SECRET'),
		CLOVER_PRIVATE_TOKEN: secret('CLOVER_PRIVATE_TOKEN'),
		CLOVER_PUBLIC_KEY: process.env.CLOVER_PUBLIC_KEY || "DEFINE THE CLOVER PUBLIC KEY IN THE ENVIRONMENT VARIABLES",
		PAYMENT_PROCESSING_QUEUE_URL: process.env.PAYMENT_PROCESSING_QUEUE_URL || "DEFINE THE PAYMENT PROCESSING QUEUE URL IN THE ENVIRONMENT VARIABLES",

	},
})
