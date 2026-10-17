import { Amplify } from 'aws-amplify'
import { parseAmplifyConfig } from 'aws-amplify/utils'
import outputs from '../amplify_outputs.json'

const amplifyConfig = parseAmplifyConfig(outputs)

Amplify.configure(
  {
    ...amplifyConfig,
    API: {
      ...amplifyConfig.API,
      REST: outputs.custom.API,
    },
  },
  {
    API: {
      REST: {
        retryStrategy: {
          strategy: 'no-retry',
        },
      }
    }
  }
)
