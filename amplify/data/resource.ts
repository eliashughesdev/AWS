import { a, defineData, type ClientSchema } from '@aws-amplify/backend'

const schema = a.schema({
	User: a.model({
		name: a.string(),
		isActive: a.boolean()
	})
		.authorization(allow => [allow.authenticated()]) // todo fixme
})

export type Schema = ClientSchema<typeof schema>;
export const data = defineData({
	schema
})
