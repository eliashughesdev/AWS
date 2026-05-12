import { defineFunction } from '@aws-amplify/backend'

export const mainApiFn = defineFunction({
  name: 'main-api-fn',
  resourceGroupName: 'data',
  timeoutSeconds: 28,
  environment: {
    // Static infrastructure constants — these never change between environments
    CONNECTIONS_TABLE_NAME: 'v1WebSocketConnectionsTable',
    WEBSOCKET_STAGE: 'v1',
    // All other config and secrets are loaded from SSM at runtime under /loudibly/api/
  },
})
