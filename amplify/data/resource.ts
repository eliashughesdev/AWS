import { a, defineData, type ClientSchema } from '@aws-amplify/backend'

const schema = a.schema({
  User: a.model({
    name: a.string(),
    isActive: a.boolean()
  })
    .authorization(allow => [allow.publicApiKey()]) // temporary: auth removed for CFN recovery
})

export type Schema = ClientSchema<typeof schema>
export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'apiKey',
  },
})
