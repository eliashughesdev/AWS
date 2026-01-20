import { secret } from '@aws-amplify/backend'
import { defineFunction } from '@aws-amplify/backend'

export const mainApiFn = defineFunction({
	name: "main-api-fn",
	resourceGroupName: 'data',
	timeoutSeconds: 28,
	environment: {
		TATUM_API_KEY: secret('TATUM_API_KEY'),
		TATUM_KMS_BASE_URL: process.env.TATUM_KMS_BASE_URL || 'https://api.tatum.io/v3',
		EVERVAULT_TEAM_ID: process.env.EVERVAULT_TEAM_ID || 'SET_THE_TEAM_ID_VARIABLE',
		EVERVAULT_APP_ID: process.env.EVERVAULT_APP_ID || 'SET_THE_APP_ID_VARIABLE',
		STRIPE_API_KEY: secret('STRIPE_API_KEY'),
	},
})
