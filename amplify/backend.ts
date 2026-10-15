import * as path from 'path'
import * as url from 'node:url'
import { defineBackend } from '@aws-amplify/backend'
import { Duration, Stack } from 'aws-cdk-lib'
import {
  AccessLogFormat,
  AuthorizationType,
  Cors,
  IdentitySource,
  LambdaIntegration, LogGroupLogDestination,
  MethodLoggingLevel,
  RequestAuthorizer,
  ResponseType,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway'
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as kms from 'aws-cdk-lib/aws-kms'
import * as dynamo from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as cr from 'aws-cdk-lib/custom-resources'
import { Code, Function, Runtime, StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { mainApiFn } from './fn/api/resource'
import { auth } from './auth/resource'
import { customMessageFn } from './auth/custom-message/resource'
import { data } from './data/resource'
import { AttributeType } from 'aws-cdk-lib/aws-dynamodb'
import { SYSTEM_MERCHANT_ID, SYSTEM_MERCHANT_NAME } from './utils/systemMerchant'
import { PUBLIC_API_SURFACE, publicRoutes } from './service/publicRoutes'
import {
  API_KEY_ISSUER_FN, API_KEY_KMS_ALIAS, API_KEY_PARAMETER_PREFIX, API_KEY_USAGE_TABLE, API_KEYS_BY_OWNER, API_KEYS_TABLE,
} from './utils/apiKeyStore'


const backend = defineBackend({
  auth,
  data,
  mainApiFn,
  customMessageFn,
})

const apiStack = backend.createStack('loudibly-stack')

backend.mainApiFn.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['ssm:*', 'dynamodb:*', 'sqs:*'],
    resources: ['*']
  })
)

backend.mainApiFn.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['ses:SendEmail', 'ses:SendRawEmail'],
    resources: ['*']
  })
)

// Onboarding creates Cognito users on behalf of a merchant platform.
backend.mainApiFn.addEnvironment('COGNITO_USER_POOL_ID', backend.auth.resources.userPool.userPoolId)

backend.mainApiFn.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'cognito-idp:AdminCreateUser',
      'cognito-idp:AdminAddUserToGroup',
      'cognito-idp:AdminDisableUser',
      'cognito-idp:AdminSetUserPassword',
      'cognito-idp:AdminUpdateUserAttributes',
      'cognito-idp:AdminGetUser',
      'cognito-idp:ListUsers',
    ],
    resources: [backend.auth.resources.userPool.userPoolArn]
  })
)

backend.customMessageFn.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
    resources: ['*']
  })
)

const customAuthorizerFn = new Function(apiStack, 'CustomAuthorizerFunction', {
  functionName: 'custom-authorizer-fn',
  runtime: Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: Code.fromAsset(path.join(process.cwd(), './amplify/fn/authorizer')),
  environment: {
    COGNITO_USER_POOL_ID: backend.auth.resources.userPool.userPoolId,
  },
})

customAuthorizerFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['cognito-idp:*'],
  resources: ['*']
}))

/** SQS */
const v1WebhookQueue = new sqs.Queue(apiStack, 'v1WebhookQueue', {
  queueName: 'v1-webhook-queue',
  visibilityTimeout: Duration.seconds(300),
  retentionPeriod: Duration.days(14),
})

const v1GeneralQueue = new sqs.Queue(apiStack, 'v1GeneralQueue', {
  queueName: 'v1-general-queue',
  visibilityTimeout: Duration.seconds(300),
  retentionPeriod: Duration.days(14),
})

const v1PaymentProcessingQueue = new sqs.Queue(apiStack, 'v1PaymentProcessingQueue', {
  queueName: 'v1-payment-processing-queue',
  visibilityTimeout: Duration.seconds(300),
  retentionPeriod: Duration.days(14),
})

const v1WithdrawalProcessingQueue = new sqs.Queue(apiStack, 'v1WithdrawalProcessingQueue', {
  queueName: 'v1-withdrawal-processing-queue',
  visibilityTimeout: Duration.seconds(300),
  retentionPeriod: Duration.days(14),
})

const v1AccountBackfillQueue = new sqs.Queue(apiStack, 'v1AccountBackfillQueue', {
  queueName: 'v1-account-backfill-queue',
  visibilityTimeout: Duration.seconds(300),
  retentionPeriod: Duration.days(14)
})

const v1SweepQueue = new sqs.Queue(apiStack, 'v1SweepQueue', {
  queueName: 'v1-sweep-queue',
  visibilityTimeout: Duration.seconds(300),
  retentionPeriod: Duration.days(14),
})

const webSocketApi = new apigatewayv2.WebSocketApi(apiStack, 'PaymentWebSocketApi', {
  apiName: 'PaymentWebSocketApi',
})

const tatumApiKeySecret = secretsmanager.Secret.fromSecretNameV2(apiStack, 'TatumApiKeySecret', 'TATUM_API_KEY')

const sqsV1WebhookProcessingFn = new lambda.NodejsFunction(apiStack, 'SQSv1WebhookProcessingFn', {
  entry: url.fileURLToPath(new URL('./fn/sqs-processor/webhook/handler.ts', import.meta.url)),
  runtime: Runtime.NODEJS_20_X,
  functionName: 'sqsV1WebhookProcessorFn',
  timeout: Duration.seconds(280),
  environment: {
    V1_WEBHOOK_QUEUE_URL: v1WebhookQueue.queueUrl,
    PAYMENT_PROCESSING_QUEUE_URL: v1PaymentProcessingQueue.queueUrl,
    WITHDRAWAL_QUEUE_URL: v1WithdrawalProcessingQueue.queueUrl,
    SWEEP_QUEUE_URL: v1SweepQueue.queueUrl,
    TATUM_API_KEY: tatumApiKeySecret.secretValueFromJson('TATUM_API_KEY').unsafeUnwrap(),
    CONNECTIONS_TABLE_NAME: 'v1WebSocketConnectionsTable',
    WEBSOCKET_API_ID: webSocketApi.apiId,
    WEBSOCKET_STAGE: 'v1',
  },
})

sqsV1WebhookProcessingFn.addEventSource(
  new eventsources.SqsEventSource(v1WebhookQueue, {
    batchSize: 10,
    maxBatchingWindow: Duration.seconds(30),
    reportBatchItemFailures: true,
  })
)

sqsV1WebhookProcessingFn.addEventSource(
  new eventsources.SqsEventSource(v1PaymentProcessingQueue, {
    batchSize: 1,
    maxBatchingWindow: Duration.seconds(0),
    reportBatchItemFailures: true,
  })
)

sqsV1WebhookProcessingFn.addEventSource(
  new eventsources.SqsEventSource(v1WithdrawalProcessingQueue, {
    batchSize: 1,
    maxBatchingWindow: Duration.seconds(0),
    reportBatchItemFailures: true,
  })
)

sqsV1WebhookProcessingFn.addEventSource(
  new eventsources.SqsEventSource(v1AccountBackfillQueue, {
    batchSize: 1,
    maxBatchingWindow: Duration.seconds(0),
    reportBatchItemFailures: true
  })
)

sqsV1WebhookProcessingFn.addEventSource(
  new eventsources.SqsEventSource(v1SweepQueue, {
    batchSize: 1,
    maxBatchingWindow: Duration.seconds(0),
    reportBatchItemFailures: true,
  })
)

sqsV1WebhookProcessingFn.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['dynamodb:*', 'sqs:*', 'execute-api:*', 'ssm:GetParametersByPath', 'ssm:GetParameters', 'ssm:GetParameter'],
    resources: ['*']
  })
)

const sqsV1GeneralProcessingFn = new lambda.NodejsFunction(apiStack, 'SQSv1GeneralProcessingFn', {
  entry: url.fileURLToPath(new URL('./fn/sqs-processor/general/handler.ts', import.meta.url)),
  runtime: Runtime.NODEJS_20_X,
  functionName: 'sqsV1GeneralProcessorFn',
  timeout: Duration.seconds(60),
  environment: {
    V1_GENERAL_QUEUE_URL: v1GeneralQueue.queueUrl,
  },
})

sqsV1GeneralProcessingFn.addEventSource(
  new eventsources.SqsEventSource(v1GeneralQueue, {
    batchSize: 10,
    maxBatchingWindow: Duration.seconds(30),
    reportBatchItemFailures: true,
  })
)

const apiLogGroup = new LogGroup(apiStack, 'ApiGatewayLogGroup', {
  logGroupName: '/aws/apigateway/LoudiblyRestApi',
  retention: RetentionDays.ONE_YEAR
})

const loudiblyRestApi = new RestApi(apiStack, 'LoudiblyRestApi', {
  restApiName: 'loudiblyRestApi',
  deploy: true,
  deployOptions: {
    stageName: 'v1',
    loggingLevel: MethodLoggingLevel.INFO,
    accessLogDestination: new LogGroupLogDestination(apiLogGroup),
    accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
    variables: {
      V1_WEBHOOK_QUEUE_URL: v1WebhookQueue.queueUrl,
      V1_GENERAL_QUEUE_URL: v1GeneralQueue.queueUrl,
      PAYMENT_PROCESSING_QUEUE_URL: v1PaymentProcessingQueue.queueUrl,
      WITHDRAWAL_QUEUE_URL: v1WithdrawalProcessingQueue.queueUrl,
    }
  },
  defaultCorsPreflightOptions: {
    allowOrigins: Cors.ALL_ORIGINS,
    allowMethods: Cors.ALL_METHODS,
    allowHeaders: [...Cors.DEFAULT_HEADERS, 'X-Project', 'Idempotency-Key'],
  },
})

// Gateway-generated errors (e.g. authorizer 401/403) bypass the Lambda, so they
// need CORS headers here or browsers report them as CORS failures.
const corsGatewayHeaders = {
  'Access-Control-Allow-Origin': "'*'",
  'Access-Control-Allow-Headers': "'*'",
}
loudiblyRestApi.addGatewayResponse('Default4xxCors', {
  type: ResponseType.DEFAULT_4XX,
  responseHeaders: corsGatewayHeaders,
})
loudiblyRestApi.addGatewayResponse('Default5xxCors', {
  type: ResponseType.DEFAULT_5XX,
  responseHeaders: corsGatewayHeaders,
})

const apiGatewayRole = new iam.Role(apiStack, 'ApiGatewayRole', {
  assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com')
})

const lambdaIntegration = new LambdaIntegration(
  backend.mainApiFn.resources.lambda
)

const healthPath = loudiblyRestApi.root.addResource('health', {
  defaultMethodOptions: {
    authorizationType: AuthorizationType.NONE,
  },
})
healthPath.addMethod('GET', lambdaIntegration)

const customAuthorizer = new RequestAuthorizer(apiStack, 'CustomAuthorizer', {
  handler: customAuthorizerFn,
  identitySources: [
    IdentitySource.header('X-Project'),
    IdentitySource.header('Authorization'),
  ],
  resultsCacheTtl: Duration.seconds(0)
})
customAuthorizerFn.grantInvoke(apiGatewayRole)

const authOptions = {
  authorizationType: AuthorizationType.CUSTOM,
  authorizer: customAuthorizer,
  requestParameters: {
    'method.request.header.Authorization': false,
    'method.request.header.X-Project': false
  }
}

const proxyAuthOptions = {
  defaultMethodOptions: authOptions
}

const accountsPath = loudiblyRestApi.root.addResource('accounts')
const paymentsPath = loudiblyRestApi.root.addResource('payments')
const webhooksPath = loudiblyRestApi.root.addResource('webhook')
const merchantsPath = loudiblyRestApi.root.addResource('merchants')
webhooksPath.addMethod('POST', lambdaIntegration)

accountsPath.addProxy({ anyMethod: true, defaultIntegration: lambdaIntegration, ...proxyAuthOptions })
paymentsPath.addProxy({ anyMethod: true, defaultIntegration: lambdaIntegration, ...proxyAuthOptions })
merchantsPath.addProxy({ anyMethod: true, defaultIntegration: lambdaIntegration, ...proxyAuthOptions })
webhooksPath.addProxy({ anyMethod: true, defaultIntegration: lambdaIntegration })

const onboardingPath = loudiblyRestApi.root.addResource('onboarding', {
  defaultMethodOptions: { authorizationType: AuthorizationType.NONE },
})
onboardingPath.addProxy({
  anyMethod: true,
  defaultIntegration: lambdaIntegration,
  defaultMethodOptions: { authorizationType: AuthorizationType.NONE },
})

// The API for the public internet: merchants' platforms and signed-in users. It has
// one resource per route in publicRoutes and nothing else, so staff routes, provider
// webhooks and internal operations can only be reached through loudiblyRestApi.
// Same Lambda and authorizer; the stage variable tells the router where a request
// came in. Documented in docs/openapi/public-api.yaml.
const publicApiLogGroup = new LogGroup(apiStack, 'PublicApiLogGroup', {
  logGroupName: '/aws/apigateway/LoudiblyPublicApi',
  retention: RetentionDays.ONE_YEAR
})

const publicApi = new RestApi(apiStack, 'LoudiblyPublicApi', {
  restApiName: 'loudiblyPublicApi',
  deploy: true,
  deployOptions: {
    // Same stage name as the internal API: HMAC callers sign the path, /v1 included
    stageName: 'v1',
    loggingLevel: MethodLoggingLevel.INFO,
    accessLogDestination: new LogGroupLogDestination(publicApiLogGroup),
    accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
    throttlingRateLimit: 50,
    throttlingBurstLimit: 100,
    variables: { API_SURFACE: PUBLIC_API_SURFACE },
  },
  defaultCorsPreflightOptions: {
    allowOrigins: Cors.ALL_ORIGINS,
    allowMethods: Cors.ALL_METHODS,
    allowHeaders: [...Cors.DEFAULT_HEADERS, 'X-Project', 'Idempotency-Key'],
  },
})
publicApi.addGatewayResponse('Default4xxCors', {
  type: ResponseType.DEFAULT_4XX,
  responseHeaders: corsGatewayHeaders,
})
publicApi.addGatewayResponse('Default5xxCors', {
  type: ResponseType.DEFAULT_5XX,
  responseHeaders: corsGatewayHeaders,
})

// An authorizer belongs to one API, so the same function gets a second one
const publicApiAuthorizer = new RequestAuthorizer(apiStack, 'PublicApiAuthorizer', {
  handler: customAuthorizerFn,
  identitySources: [
    IdentitySource.header('X-Project'),
    IdentitySource.header('Authorization'),
  ],
  resultsCacheTtl: Duration.seconds(0)
})

// Every method adds a statement to mainApiFn's resource policy, which is capped at
// 20 KB; the console's test-invoke permission would double them and pass the cap
const publicLambdaIntegration = new LambdaIntegration(
  backend.mainApiFn.resources.lambda,
  { allowTestInvoke: false }
)

for (const route of publicRoutes) {
  publicApi.root.resourceForPath(route.path).addMethod(
    route.method,
    publicLambdaIntegration,
    route.auth === 'none'
      ? { authorizationType: AuthorizationType.NONE }
      : { ...authOptions, authorizer: publicApiAuthorizer }
  )
}

const apiRestPolicy = new iam.Policy(apiStack, 'LoudiblyRestApiPolicy', {
  statements: [
    new iam.PolicyStatement({
      actions: ['execute-api:Invoke', 'ssm:*'],
      resources: [
        `${loudiblyRestApi.arnForExecuteApi('*', '/health', 'v1')}`,
        `${loudiblyRestApi.arnForExecuteApi('*', '/accounts*', 'v1')}`,
        `${loudiblyRestApi.arnForExecuteApi('*', '/payments*', 'v1')}`,
        `${loudiblyRestApi.arnForExecuteApi('*', '/webhook*', 'v1')}`,
      ],
    }),
  ],
})

backend.auth.resources.authenticatedUserIamRole.attachInlinePolicy(
  apiRestPolicy
)
backend.auth.resources.unauthenticatedUserIamRole.attachInlinePolicy(
  apiRestPolicy
)

const v1UserKeysTable = new dynamo.Table(apiStack, 'UserKeysTable', {
  partitionKey: {
    name: 'id',
    type: dynamo.AttributeType.STRING,
  },
  billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
  // Keys only, on every streamed table: a stream with images puts merchant keys, card rows and
  // customers' details into whatever reads it (PCI F4). Nothing needs the images yet.
  stream: dynamo.StreamViewType.KEYS_ONLY,
  tableName: 'v1UserKeysTable',
})

const v2CustomerTable = new dynamo.Table(apiStack, 'CustomerTable', {
  partitionKey: {
    name: 'id',
    type: dynamo.AttributeType.STRING,
  },
  sortKey: {
    name: 'sk',
    type: dynamo.AttributeType.STRING,
  },
  billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
  stream: dynamo.StreamViewType.KEYS_ONLY,
  tableName: 'v2CustomerTable',
  // Idempotency-Key rows (utils/idempotency.ts) expire after a day; no other row has a ttl
  timeToLiveAttribute: 'ttl',
})

v2CustomerTable.addGlobalSecondaryIndex({
  indexName: 'v1v2CustomerTableToAccountId',
  partitionKey: {name: 'sk', type: dynamo.AttributeType.STRING},
  sortKey: {name: 'id', type: dynamo.AttributeType.STRING },
  projectionType: dynamo.ProjectionType.ALL
})

v2CustomerTable.addGlobalSecondaryIndex({
  indexName: 'v1v2CustomerTableByDepositAddress',
  partitionKey: { name: 'depositAddress', type: dynamo.AttributeType.STRING },
  projectionType: dynamo.ProjectionType.ALL,
})

// const v1CustomerTable = new dynamo.Table(apiStack, 'CustomerTable', {
//  partitionKey: {
//    name: 'id',
//    type: dynamo.AttributeType.STRING,
//  },
//  billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
//  stream: dynamo.StreamViewType.NEW_AND_OLD_IMAGES,
//  tableName: 'v1CustomerTable',
// })

const v1AccountBalanceTable = new dynamo.Table(apiStack, 'AccountBalanceTable', {
  partitionKey: {
    name: 'id',
    type: dynamo.AttributeType.STRING,
  },
  billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
  stream: dynamo.StreamViewType.KEYS_ONLY,
  tableName: 'v1AccountBalanceTable',
})

const v1WebhookIPWhitelistTable = new dynamo.Table(apiStack, 'WebhookIPWhitelistTable', {
  partitionKey: {
    name: 'id',
    type: dynamo.AttributeType.STRING,
  },
  billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
  stream: dynamo.StreamViewType.KEYS_ONLY,
  tableName: 'v1WebhookIPWhitelistTable',
})

v1WebhookIPWhitelistTable.addGlobalSecondaryIndex({
  indexName: 'v1v1WebhookIPWhitelistTableIpToProviderName',
  partitionKey: { name: 'provider_code', type: AttributeType.STRING },
  sortKey: { name: 'created_at', type: AttributeType.NUMBER },
})

const v1WebSocketConnectionsTable = new dynamo.Table(apiStack, 'WebSocketConnectionsTable', {
  partitionKey: {
    name: 'connectionId',
    type: dynamo.AttributeType.STRING,
  },
  billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
  tableName: 'v1WebSocketConnectionsTable',
  timeToLiveAttribute: 'ttl',
})

const v1BinCacheTable = new dynamo.Table(apiStack, 'BinCacheTable', {
  partitionKey: {
    name: 'id',
    type: dynamo.AttributeType.STRING,
  },
  billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
  tableName: 'v2BinCacheTable',
  timeToLiveAttribute: 'ttl',
})

v1WebSocketConnectionsTable.addGlobalSecondaryIndex({
  indexName: 'UserIdIndex',
  partitionKey: { name: 'userId', type: AttributeType.STRING },
  sortKey: { name: 'connectionId', type: AttributeType.STRING },
})

const v1PaymentTransactionLogsTable = new dynamo.Table(apiStack, 'PaymentTransactionLogsTable', {
  partitionKey: {
    name: 'id',
    type: dynamo.AttributeType.STRING,
  },
  sortKey: {
    name: 'sk',
    type: dynamo.AttributeType.STRING,
  },
  billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
  tableName: 'v1PaymentTransactionLogsTable',
})

v1PaymentTransactionLogsTable.addGlobalSecondaryIndex({
  indexName: 'UserIdIndex',
  partitionKey: { name: 'userId', type: AttributeType.STRING },
  sortKey: { name: 'createdAt', type: AttributeType.STRING },
  projectionType: dynamo.ProjectionType.ALL,
})

v1PaymentTransactionLogsTable.addGlobalSecondaryIndex({
  indexName: 'ProviderRefIndex',
  partitionKey: { name: 'providerRef', type: AttributeType.STRING },
  sortKey: { name: 'sk', type: AttributeType.STRING },
  projectionType: dynamo.ProjectionType.ALL,
})

const v1TransactionLogsTable = new dynamo.Table(apiStack, 'TransactionLogsTable', {
  partitionKey: {
    name: 'id',
    type: dynamo.AttributeType.STRING,
  },
  sortKey: {
    name: 'sk',
    type: dynamo.AttributeType.STRING,
  },
  billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
  tableName: 'v1TransactionLogsTable',
})

const v1MerchantTable = new dynamo.Table(apiStack, 'MerchantTable', {
  partitionKey: {
    name: 'id',
    type: dynamo.AttributeType.STRING,
  },
  sortKey: {
    name: 'sk',
    type: dynamo.AttributeType.STRING,
  },
  billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
  tableName: 'v1MerchantTable',
})

// API keys that users and merchants call the public API with (docs/public-api-plan.md D2.1):
// one row per key, never its secret or hash (those are in SSM, see below)
const v1ApiKeysTable = new dynamo.Table(apiStack, 'ApiKeysTable', {
  partitionKey: { name: 'id', type: dynamo.AttributeType.STRING },
  billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
  tableName: API_KEYS_TABLE,
})
v1ApiKeysTable.addGlobalSecondaryIndex({
  indexName: API_KEYS_BY_OWNER,
  partitionKey: { name: 'ownerId', type: dynamo.AttributeType.STRING },
  sortKey: { name: 'createdAt', type: dynamo.AttributeType.STRING },
  projectionType: dynamo.ProjectionType.ALL,
})

// Each key's calls per second, for its rate limit (D2.5); a row is useless a second later
const v1ApiKeyUsageTable = new dynamo.Table(apiStack, 'ApiKeyUsageTable', {
  partitionKey: { name: 'id', type: dynamo.AttributeType.STRING },
  billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
  tableName: API_KEY_USAGE_TABLE,
  timeToLiveAttribute: 'ttl',
})

// The system merchant (the system's own direct customers, no API key) exists in
// every environment: each deploy creates its profile unless it is already there.
const ensureSystemMerchant: cr.AwsSdkCall = {
  service: 'DynamoDB',
  action: 'putItem',
  parameters: {
    TableName: v1MerchantTable.tableName,
    Item: {
      id: { S: SYSTEM_MERCHANT_ID },
      sk: { S: 'PROFILE' },
      name: { S: SYSTEM_MERCHANT_NAME },
      status: { S: 'active' },
      accountingCurrency: { S: 'USD' },
      createdBy: { S: 'deploy' },
      // A new value on every deploy, which is also what makes this run on every deploy
      createdAt: { S: new Date().toISOString() },
    },
    ConditionExpression: 'attribute_not_exists(id)',
  },
  // Already there: leave it exactly as it is
  ignoreErrorCodesMatching: 'ConditionalCheckFailedException',
  physicalResourceId: cr.PhysicalResourceId.of('system-merchant'),
}
const systemMerchant = new cr.AwsCustomResource(apiStack, 'SystemMerchant', {
  onCreate: ensureSystemMerchant,
  onUpdate: ensureSystemMerchant,
  policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: [v1MerchantTable.tableArn] }),
  // The runtime's own SDK has DynamoDB; installing the latest took ~80 s of every deploy
  installLatestAwsSdk: false,
})
systemMerchant.node.addDependency(v1MerchantTable)

const streamTopic = new sns.Topic(apiStack, 'v1StreamTopic')

const stream = new lambda.NodejsFunction(apiStack, 'streamTopicHandler', {
  entry: url.fileURLToPath(new URL('./fn/stream/handler.ts', import.meta.url)),
  environment: {},
  runtime: Runtime.NODEJS_20_X,
  functionName: 'streamTopicHandlerFn',
  timeout: Duration.seconds(28)
})

streamTopic.addSubscription(new subscriptions.LambdaSubscription(stream))
stream.addEventSource(
  new eventsources.DynamoEventSource(v1UserKeysTable, {
    startingPosition: StartingPosition.LATEST
  })
)

stream.addEventSource(
  new eventsources.DynamoEventSource(v2CustomerTable, {
    startingPosition: StartingPosition.LATEST
  })
)

stream.addEventSource(
  new eventsources.DynamoEventSource(v1WebhookIPWhitelistTable, {
    startingPosition: StartingPosition.LATEST
  })
)

// WebSocket API Lambda Handlers
const wsConnectFn = new lambda.NodejsFunction(apiStack, 'WebSocketConnectFn', {
  entry: url.fileURLToPath(new URL('./fn/websocket/connect.ts', import.meta.url)),
  runtime: Runtime.NODEJS_20_X,
  functionName: 'wsConnectHandlerFn',
  timeout: Duration.seconds(30),
  environment: {
    CONNECTIONS_TABLE_NAME: v1WebSocketConnectionsTable.tableName,
  },
})

const wsDisconnectFn = new lambda.NodejsFunction(apiStack, 'WebSocketDisconnectFn', {
  entry: url.fileURLToPath(new URL('./fn/websocket/disconnect.ts', import.meta.url)),
  runtime: Runtime.NODEJS_20_X,
  functionName: 'wsDisconnectHandlerFn',
  timeout: Duration.seconds(30),
  environment: {
    CONNECTIONS_TABLE_NAME: v1WebSocketConnectionsTable.tableName,
  },
})

v1WebSocketConnectionsTable.grantReadWriteData(wsConnectFn)
v1WebSocketConnectionsTable.grantReadWriteData(wsDisconnectFn)

// Configure WebSocket API routes
webSocketApi.addRoute('$connect', {
  integration: new apigatewayv2Integrations.WebSocketLambdaIntegration('ConnectIntegration', wsConnectFn),
})

webSocketApi.addRoute('$disconnect', {
  integration: new apigatewayv2Integrations.WebSocketLambdaIntegration('DisconnectIntegration', wsDisconnectFn),
})

const webSocketStage = new apigatewayv2.WebSocketStage(apiStack, 'PaymentWebSocketStage', {
  webSocketApi,
  stageName: 'v1',
  autoDeploy: true,
})

v1UserKeysTable.grantReadWriteData(apiGatewayRole)
v1UserKeysTable.grantReadWriteData(customAuthorizerFn)
v1AccountBalanceTable.grantReadWriteData(sqsV1WebhookProcessingFn)
v1UserKeysTable.grantStreamRead(stream)

v2CustomerTable.grantReadWriteData(apiGatewayRole)
v2CustomerTable.grantReadWriteData(sqsV1WebhookProcessingFn)
v2CustomerTable.grantStreamRead(stream)

v1WebhookIPWhitelistTable.grantReadWriteData(apiGatewayRole)
v1WebhookIPWhitelistTable.grantStreamRead(stream)

v1WebSocketConnectionsTable.grantReadWriteData(sqsV1WebhookProcessingFn)
v1BinCacheTable.grantReadWriteData(sqsV1WebhookProcessingFn)
v1PaymentTransactionLogsTable.grantReadWriteData(sqsV1WebhookProcessingFn)

v1WebhookQueue.grantSendMessages(apiGatewayRole)
v1WebhookQueue.grantConsumeMessages(sqsV1WebhookProcessingFn)
v1GeneralQueue.grantSendMessages(apiGatewayRole)
v1GeneralQueue.grantConsumeMessages(sqsV1GeneralProcessingFn)
v1PaymentProcessingQueue.grantSendMessages(apiGatewayRole)
v1PaymentProcessingQueue.grantConsumeMessages(sqsV1WebhookProcessingFn)
v1WithdrawalProcessingQueue.grantSendMessages(apiGatewayRole)
v1WithdrawalProcessingQueue.grantConsumeMessages(sqsV1WebhookProcessingFn)
v1AccountBackfillQueue.grantSendMessages(apiGatewayRole)
v1AccountBackfillQueue.grantConsumeMessages(sqsV1WebhookProcessingFn)
tatumApiKeySecret.grantRead(sqsV1WebhookProcessingFn)

sqsV1WebhookProcessingFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['execute-api:ManageConnections'],
  resources: [`arn:aws:execute-api:${Stack.of(apiStack).region}:${Stack.of(apiStack).account}:${webSocketApi.apiId}/*`],
}))

// mainApiFn needs WebSocket access for Stripe webhook handler notifications
backend.mainApiFn.resources.lambda.addToRolePolicy(new iam.PolicyStatement({
  actions: ['execute-api:ManageConnections'],
  resources: ['*'],
}))

// --- Derived (HD) wallets (B31) ---
// The one role that may use the per-seed KMS keys; each key's policy names it.
// Both functions below run the same handler under it, each serving only its own
// operations, so asking for addresses and asking for signatures are separate
// permissions.
const HD_SEED_PARAMETERS = 'arn:aws:ssm:*:*:parameter/loudibly/hd-seed/*'

const hdSignerRole = new iam.Role(apiStack, 'HdSignerRole', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
})

// A seed's key is created here and used through its own key policy
hdSignerRole.addToPolicy(new iam.PolicyStatement({
  actions: ['kms:CreateKey', 'kms:TagResource'],
  resources: ['*'],
}))
// No delete: a seed parameter is written once and never removed from here
hdSignerRole.addToPolicy(new iam.PolicyStatement({
  actions: ['ssm:PutParameter', 'ssm:GetParameter'],
  resources: [HD_SEED_PARAMETERS],
}))
hdSignerRole.addToPolicy(new iam.PolicyStatement({
  actions: ['dynamodb:GetItem', 'dynamodb:Query'],
  resources: [v2CustomerTable.tableArn, `${v2CustomerTable.tableArn}/index/*`],
}))
hdSignerRole.addToPolicy(new iam.PolicyStatement({
  actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
  resources: [v1MerchantTable.tableArn],
}))

const hdFunction = (id: string, functionName: string, operations: string) => new lambda.NodejsFunction(apiStack, id, {
  entry: url.fileURLToPath(new URL('./fn/hd-signer/handler.ts', import.meta.url)),
  runtime: Runtime.NODEJS_20_X,
  functionName,
  role: hdSignerRole,
  memorySize: 512,
  timeout: Duration.seconds(30),
  environment: {
    HD_OPERATIONS: operations,
    HD_SIGNER_ROLE_ARN: hdSignerRole.roleArn,
  },
})

// Neither has a trigger or a URL: they are only ever invoked by the two roles below
hdFunction('HdAddressFn', 'hdAddressFn', 'createSeed,allocateAddress')
const hdSignerFn = hdFunction('HdSignerFn', 'hdSignerFn', 'sign')

// The API provisions accounts, so it may ask for seeds and addresses, never for
// signatures. The ARN is built from the name: a reference to the function would
// create the same circular stack dependency as a table grant on mainApiFn.
backend.mainApiFn.resources.lambda.addToRolePolicy(new iam.PolicyStatement({
  actions: ['lambda:InvokeFunction'],
  resources: ['arn:aws:lambda:*:*:function:hdAddressFn'],
}))
// mainApiFn has ssm:* on everything; seeds are the exception
backend.mainApiFn.resources.lambda.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.DENY,
  actions: ['ssm:*'],
  resources: [HD_SEED_PARAMETERS],
}))

// Withdrawals and sweeps are signed by the queue processor
sqsV1WebhookProcessingFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['lambda:InvokeFunction'],
  resources: [hdSignerFn.functionArn],
}))

// --- API keys (docs/public-api-plan.md D2.1) ---
// A key's secret is never stored. Its SHA-256 is an SSM SecureString under its own KMS key, which
// only apiKeyIssuerFn may encrypt with and only the authorizer may decrypt with. mainApiFn asks
// the issuer to create or delete one and never reads it.
const API_KEY_PARAMETERS = `arn:aws:ssm:*:*:parameter${API_KEY_PARAMETER_PREFIX}*`

const apiKeyIssuerRole = new iam.Role(apiStack, 'ApiKeyIssuerRole', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
})
const authorizerRole = customAuthorizerFn.role!

const apiKeyHashKey = new kms.Key(apiStack, 'ApiKeyHashKey', {
  alias: API_KEY_KMS_ALIAS,
  description: 'Encrypts the hashes of API key secrets in SSM (/loudibly/api-keys/)',
  enableKeyRotation: true,
  policy: new iam.PolicyDocument({
    statements: [
      new iam.PolicyStatement({
        sid: 'AccountAdministers',
        principals: [new iam.AccountRootPrincipal()],
        actions: ['kms:*'],
        resources: ['*'],
      }),
      new iam.PolicyStatement({
        sid: 'IssuerEncrypts',
        principals: [new iam.ArnPrincipal(apiKeyIssuerRole.roleArn)],
        actions: ['kms:Encrypt', 'kms:DescribeKey'],
        resources: ['*'],
      }),
      new iam.PolicyStatement({
        sid: 'AuthorizerDecrypts',
        principals: [new iam.ArnPrincipal(authorizerRole.roleArn)],
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: ['*'],
      }),
      // Whatever IAM grants anyone else (kms:* on '*', the account's administrators included)
      new iam.PolicyStatement({
        sid: 'OnlyAuthorizerDecrypts',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['kms:Decrypt'],
        resources: ['*'],
        conditions: { ArnNotEquals: { 'aws:PrincipalArn': authorizerRole.roleArn } },
      }),
    ],
  }),
})

apiKeyIssuerRole.addToPolicy(new iam.PolicyStatement({
  actions: ['ssm:PutParameter', 'ssm:DeleteParameter'],
  resources: [API_KEY_PARAMETERS],
}))
apiKeyIssuerRole.addToPolicy(new iam.PolicyStatement({
  actions: ['kms:Encrypt'],
  resources: [apiKeyHashKey.keyArn],
}))
apiKeyIssuerRole.addToPolicy(new iam.PolicyStatement({
  actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
  resources: [v1ApiKeysTable.tableArn],
}))

// No trigger or URL: only mainApiFn invokes it
new lambda.NodejsFunction(apiStack, 'ApiKeyIssuerFn', {
  entry: url.fileURLToPath(new URL('./fn/api-key-issuer/handler.ts', import.meta.url)),
  runtime: Runtime.NODEJS_20_X,
  functionName: API_KEY_ISSUER_FN,
  role: apiKeyIssuerRole,
  timeout: Duration.seconds(10),
})

// The ARN is built from the name, as for hdAddressFn: a reference would make the stacks circular
backend.mainApiFn.resources.lambda.addToRolePolicy(new iam.PolicyStatement({
  actions: ['lambda:InvokeFunction'],
  resources: [`arn:aws:lambda:*:*:function:${API_KEY_ISSUER_FN}`],
}))
// mainApiFn has ssm:* on everything; key hashes are an exception, like seeds
backend.mainApiFn.resources.lambda.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.DENY,
  actions: ['ssm:*'],
  resources: [API_KEY_PARAMETERS],
}))

// The authorizer checks a key on every call (D2.3): its row, its hash, its owner, its rate (D2.5)
customAuthorizerFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['ssm:GetParameter'],
  resources: [API_KEY_PARAMETERS],
}))
customAuthorizerFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['kms:Decrypt'],
  resources: [apiKeyHashKey.keyArn],
}))
customAuthorizerFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
  resources: [v1ApiKeysTable.tableArn, v1ApiKeyUsageTable.tableArn],
}))
customAuthorizerFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['dynamodb:GetItem'],
  resources: [v2CustomerTable.tableArn, v1MerchantTable.tableArn],
}))

backend.addOutput({
  custom: {
    API: {
      [loudiblyRestApi.restApiName]: {
        endpoint: loudiblyRestApi.url,
        region: Stack.of(loudiblyRestApi).region,
        apiName: loudiblyRestApi.restApiName,
      },
      [publicApi.restApiName]: {
        endpoint: publicApi.url,
        region: Stack.of(publicApi).region,
        apiName: publicApi.restApiName,
      },
    },
    WebSocket: {
      endpoint: webSocketStage.url,
      region: Stack.of(webSocketApi).region,
    },
    Queues: {
      v1WebhookQueue: v1WebhookQueue.queueUrl,
      v1GeneralQueue: v1GeneralQueue.queueUrl,
      v1PaymentProcessingQueue: v1PaymentProcessingQueue.queueUrl,
      v1WithdrawalProcessingQueue: v1WithdrawalProcessingQueue.queueUrl,
    }
  },
})
