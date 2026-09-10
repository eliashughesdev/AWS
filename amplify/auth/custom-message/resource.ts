import { defineFunction } from '@aws-amplify/backend'
import { SSM_PATH } from '../../ssmPath'

export const customMessageFn = defineFunction({
  name: 'custom-message',
  entry: './handler.ts',
  environment: {
    SSM_PATH,
  },
})
