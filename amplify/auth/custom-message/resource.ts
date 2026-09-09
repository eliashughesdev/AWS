import { defineFunction } from '@aws-amplify/backend'

export const customMessageFn = defineFunction({
  name: 'custom-message',
  entry: './handler.ts',
  environment: {
    SSM_PATH: process.env.SSM_PATH ?? '/loudibly/api/',
  },
})
