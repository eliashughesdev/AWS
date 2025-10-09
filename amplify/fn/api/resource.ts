import { defineFunction } from '@aws-amplify/backend'

export const mainApiFn = defineFunction({
	name: "main-api-fn",
	resourceGroupName: 'data',
	timeoutSeconds: 28
})
