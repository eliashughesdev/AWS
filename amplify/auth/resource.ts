import { defineAuth } from '@aws-amplify/backend'
import { customMessageFn } from './custom-message/resource'

export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ['admin', 'user', 'staff', 'merchant'],
  triggers: {
    customMessage: customMessageFn,
  },
})
