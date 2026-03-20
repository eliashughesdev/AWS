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
  RestApi,
} from 'aws-cdk-lib/aws-apigateway'
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as dynamo from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { Code, Function, Runtime, StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { mainApiFn } from './fn/api/resource'
import { auth } from './auth/resource'
import { data } from './data/resource'
import { AttributeType } from 'aws-cdk-lib/aws-dynamodb'


const backend = defineBackend({
  auth,
  data,
  mainApiFn,
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
    actions: ['kms:CreateKey', 'kms:GetPublicKey', 'kms:DescribeKey', 'kms:TagResource'],
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

const webSocketApi = new apigatewayv2.WebSocketApi(apiStack, 'PaymentWebSocketApi', {
  apiName: 'PaymentWebSocketApi',
})

const tatumApiKeySecret = secretsmanager.Secret.fromSecretNameV2(apiStack, 'TatumApiKeySecret', 'TATUM_API_KEY')

const sqsV1WebhookProcessingFn = new lambda.NodejsFunction(apiStack, 'SQSv1WebhookProcessingFn', {
  entry: url.fileURLToPath(new URL('./fn/sqs-processor/webhook/handler.ts', import.meta.url)),
  runtime: Runtime.NODEJS_20_X,
  functionName: 'sqsV1WebhookProcessorFn',
  timeout: Duration.seconds(60),
  environment: {
    V1_WEBHOOK_QUEUE_URL: v1WebhookQueue.queueUrl,
    PAYMENT_PROCESSING_QUEUE_URL: v1PaymentProcessingQueue.queueUrl,
    WITHDRAWAL_QUEUE_URL: v1WithdrawalProcessingQueue.queueUrl,
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
    allowHeaders: [...Cors.DEFAULT_HEADERS, 'X-Project'],
  },
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
webhooksPath.addMethod('POST', lambdaIntegration)

accountsPath.addProxy({ anyMethod: true, defaultIntegration: lambdaIntegration, ...proxyAuthOptions })
paymentsPath.addProxy({ anyMethod: true, defaultIntegration: lambdaIntegration, ...proxyAuthOptions })
webhooksPath.addProxy({ anyMethod: true, defaultIntegration: lambdaIntegration })

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
  stream: dynamo.StreamViewType.NEW_AND_OLD_IMAGES,
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
  stream: dynamo.StreamViewType.NEW_AND_OLD_IMAGES,
  tableName: 'v2CustomerTable',
})

v2CustomerTable.addGlobalSecondaryIndex({
  indexName: 'v1v2CustomerTableToAccountId',
  partitionKey: {name: 'sk', type: dynamo.AttributeType.STRING},
  sortKey: {name: 'id', type: dynamo.AttributeType.STRING },
  projectionType: dynamo.ProjectionType.ALL
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
  stream: dynamo.StreamViewType.NEW_AND_OLD_IMAGES,
  tableName: 'v1AccountBalanceTable',
})

const v1WebhookIPWhitelistTable = new dynamo.Table(apiStack, 'WebhookIPWhitelistTable', {
  partitionKey: {
    name: 'id',
    type: dynamo.AttributeType.STRING,
  },
  billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
  stream: dynamo.StreamViewType.NEW_AND_OLD_IMAGES,
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

const mainLambda = backend.mainApiFn.resources.lambda as Function
mainLambda.addEnvironment('TATUM_WEBHOOK_URL', `${loudiblyRestApi.url}webhook`)

backend.addOutput({
  custom: {
    API: {
      [loudiblyRestApi.restApiName]: {
        endpoint: loudiblyRestApi.url,
        region: Stack.of(loudiblyRestApi).region,
        apiName: loudiblyRestApi.restApiName,
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
