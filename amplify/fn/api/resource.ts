import { secret } from '@aws-amplify/backend'
import { defineFunction } from '@aws-amplify/backend'

export const mainApiFn = defineFunction({
	name: "main-api-fn",
	resourceGroupName: 'data',
	timeoutSeconds: 28,
	environment: {
		TATUM_API_KEY: secret('TATUM_API_KEY'),
		TATUM_BASE_URL: process.env.TATUM_BASE_URL || 'https://api.tatum.io/v3'
	},
})
