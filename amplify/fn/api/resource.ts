import { secret, defineFunction } from '@aws-amplify/backend'

export const mainApiFn = defineFunction({
  name: 'main-api-fn',
  resourceGroupName: 'data',
  timeoutSeconds: 28,
  environment: {
    TATUM_API_KEY: secret('TATUM_API_KEY'),
    TATUM_KMS_BASE_URL: process.env.TATUM_KMS_BASE_URL || 'https://api.tatum.io/v3',
    EVERVAULT_API_KEY: secret('EVERVAULT_API_KEY'),
    STRIPE_API_KEY: secret('STRIPE_API_KEY'),
    STRIPE_WEBHOOK_SECRET: secret('STRIPE_WEBHOOK_SECRET'),
    CLOVER_PRIVATE_TOKEN: secret('CLOVER_PRIVATE_TOKEN'),
    CLOVER_PUBLIC_KEY: process.env.CLOVER_PUBLIC_KEY || 'DEFINE THE CLOVER PUBLIC KEY IN THE ENVIRONMENT VARIABLES',
    PAYMENT_PROCESSING_QUEUE_URL: process.env.PAYMENT_PROCESSING_QUEUE_URL || 'DEFINE THE PAYMENT PROCESSING QUEUE URL IN THE ENVIRONMENT VARIABLES',
    WITHDRAWAL_QUEUE_URL: process.env.WITHDRAWAL_QUEUE_URL || 'DEFINE THE WITHDRAWAL QUEUE URL IN THE ENVIRONMENT VARIABLES',
    CONNECTIONS_TABLE_NAME: 'v1WebSocketConnectionsTable',
    WEBSOCKET_API_ID: process.env.WEBSOCKET_API_ID || 'DEFINE THE WEBSOCKET API ID IN THE ENVIRONMENT VARIABLES',
    WEBSOCKET_STAGE: 'v1',
    TATUM_WEBHOOK_URL: process.env.TATUM_WEBHOOK_URL || 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/webhook',
    DIDIT_API_KEY: secret('DIDIT_API_KEY'),
    DIDIT_WEBHOOK_SECRET: secret('DIDIT_WEBHOOK_SECRET'),
    DIDIT_WORKFLOW_ID: process.env.DIDIT_WORKFLOW_ID || 'DEFINE DIDIT_WORKFLOW_ID',
    DIDIT_CALLBACK_URL: 'https://my.staging.loudibly.com/customer/kyc/complete',
  },
})
