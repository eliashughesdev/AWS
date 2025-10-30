import * as path from 'path'
import * as url from 'node:url'
import { defineBackend } from '@aws-amplify/backend'
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib'
import {
	AccessLogFormat,
	AuthorizationType,
	Cors,
	IdentitySource,
	LambdaIntegration,
	LogGroupLogDestination,
	MethodLoggingLevel,
	RequestAuthorizer,
	RestApi,
} from 'aws-cdk-lib/aws-apigateway'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as dynamo from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources'
import * as sqs from 'aws-cdk-lib/aws-sqs'
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

// Get branch name from Amplify environment variable
const branchName = process.env.AWS_BRANCH || 'main'
const isProduction = branchName === 'main'

// Helper function to generate resource names
const getResourceName = (baseName: string): string => {
	return isProduction ? baseName : `${branchName}-${baseName}`
}

backend.mainApiFn.resources.lambda.addToRolePolicy(
	new iam.PolicyStatement({
		actions: ['ssm:*', 'dynamodb:*', 'sqs:*'],
		resources: ['*']
	})
)

/** SQS */
const v1WebhookQueue = new sqs.Queue(apiStack, 'v1WebhookQueue', {
	queueName: getResourceName('v1-webhook-queue'),
	visibilityTimeout: Duration.seconds(300),
	retentionPeriod: Duration.days(14),
})

const v1GeneralQueue = new sqs.Queue(apiStack, 'v1GeneralQueue', {
	queueName: getResourceName('v1-general-queue'),
	visibilityTimeout: Duration.seconds(300),
	retentionPeriod: Duration.days(14),
})

// DynamoDB Tables with production protection - Create these first
const v1UserKeysTable = new dynamo.Table(apiStack, 'UserKeysTable', {
	partitionKey: {
		name: 'id',
		type: dynamo.AttributeType.STRING,
	},
	billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
	stream: dynamo.StreamViewType.NEW_AND_OLD_IMAGES,
	tableName: getResourceName('v1UserKeysTable'),
	// removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
	// deletionProtection: isProduction,
	// pointInTimeRecovery: isProduction,
})

const v1CustomerTable = new dynamo.Table(apiStack, 'CustomerTable', {
	partitionKey: {
		name: 'id',
		type: dynamo.AttributeType.STRING,
	},
	billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
	stream: dynamo.StreamViewType.NEW_AND_OLD_IMAGES,
	tableName: getResourceName('v1CustomerTable'),
	// removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
	// deletionProtection: isProduction,
	// pointInTimeRecovery: isProduction,
})

const v1WebhookIPWhitelistTable = new dynamo.Table(apiStack, 'WebhookIPWhitelistTable', {
	partitionKey: {
		name: 'id',
		type: dynamo.AttributeType.STRING,
	},
	billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
	stream: dynamo.StreamViewType.NEW_AND_OLD_IMAGES,
	tableName: getResourceName('v1WebhookIPWhitelistTable'),
	// removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
	// deletionProtection: isProduction,
	// pointInTimeRecovery: isProduction,
})

v1WebhookIPWhitelistTable.addGlobalSecondaryIndex({
	indexName: 'v1v1WebhookIPWhitelistTableIpToProviderName',
	partitionKey: { name: 'provider_code', type: AttributeType.STRING },
	sortKey: { name: 'created_at', type: AttributeType.NUMBER },
})

// Now create custom authorizer with environment variables
const customAuthorizerFn = new Function(apiStack, 'CustomAuthorizerFunction', {
	functionName: getResourceName('custom-authorizer-fn'),
	runtime: Runtime.NODEJS_20_X,
	handler: 'index.handler',
	code: Code.fromAsset(path.join(process.cwd(), './amplify/fn/authorizer')),
	environment: {
		V1_USER_KEYS_TABLE: v1UserKeysTable.tableName,
		BRANCH_NAME: branchName,
	}
})

customAuthorizerFn.addToRolePolicy(new iam.PolicyStatement({
	actions: ['cognito-idp:*'],
	resources: ['*']
}))

const sqsV1WebhookProcessingFn = new lambda.NodejsFunction(apiStack, 'SQSv1WebhookProcessingFn', {
	entry: url.fileURLToPath(new URL('./fn/sqs-processor/webhook/handler.ts', import.meta.url)),
	runtime: Runtime.NODEJS_20_X,
	functionName: getResourceName('sqsV1WebhookProcessorFn'),
	timeout: Duration.seconds(60),
	environment: {
		V1_WEBHOOK_QUEUE_URL: v1WebhookQueue.queueUrl,
		V1_CUSTOMER_TABLE: v1CustomerTable.tableName,
		V1_USER_KEYS_TABLE: v1UserKeysTable.tableName,
		V1_WEBHOOK_IP_TABLE: v1WebhookIPWhitelistTable.tableName,
		BRANCH_NAME: branchName,
	},
})

sqsV1WebhookProcessingFn.addEventSource(
	new eventsources.SqsEventSource(v1WebhookQueue, {
		batchSize: 10,
		maxBatchingWindow: Duration.seconds(30),
		reportBatchItemFailures: true,
	})
)

const sqsV1GeneralProcessingFn = new lambda.NodejsFunction(apiStack, 'SQSv1GeneralProcessingFn', {
	entry: url.fileURLToPath(new URL('./fn/sqs-processor/general/handler.ts', import.meta.url)),
	runtime: Runtime.NODEJS_20_X,
	functionName: getResourceName('sqsV1GeneralProcessorFn'),
	timeout: Duration.seconds(60),
	environment: {
		V1_GENERAL_QUEUE_URL: v1GeneralQueue.queueUrl,
		V1_CUSTOMER_TABLE: v1CustomerTable.tableName,
		V1_USER_KEYS_TABLE: v1UserKeysTable.tableName,
		V1_WEBHOOK_IP_TABLE: v1WebhookIPWhitelistTable.tableName,
		BRANCH_NAME: branchName,
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
	logGroupName: `/aws/apigateway/${getResourceName('LoudiblyRestApi')}`,
	retention: RetentionDays.ONE_YEAR
})

const loudiblyRestApi = new RestApi(apiStack, 'LoudiblyRestApi', {
	restApiName: getResourceName('loudiblyRestApi'),
	deploy: true,
	deployOptions: {
		stageName: 'v1',
		loggingLevel: MethodLoggingLevel.INFO,
		accessLogDestination: new LogGroupLogDestination(apiLogGroup),
		accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
		variables: {
			V1_WEBHOOK_QUEUE_URL: v1WebhookQueue.queueUrl,
			V1_GENERAL_QUEUE_URL: v1GeneralQueue.queueUrl
		}
	},
	defaultCorsPreflightOptions: {
		allowOrigins: Cors.ALL_ORIGINS,
		allowMethods: Cors.ALL_METHODS,
		allowHeaders: Cors.DEFAULT_HEADERS,
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
const webhooksPath = loudiblyRestApi.root.addResource('webhook')
webhooksPath.addMethod('POST', lambdaIntegration)

accountsPath.addProxy({ anyMethod: true, defaultIntegration: lambdaIntegration, ...proxyAuthOptions })
webhooksPath.addProxy({ anyMethod: true, defaultIntegration: lambdaIntegration })

const apiRestPolicy = new iam.Policy(apiStack, 'LoudiblyRestApiPolicy', {
	statements: [
		new iam.PolicyStatement({
			actions: ['execute-api:Invoke', 'ssm:*'],
			resources: [
				`${loudiblyRestApi.arnForExecuteApi('*', '/health', 'v1')}`,
				`${loudiblyRestApi.arnForExecuteApi('*', '/accounts*', 'v1')}`,
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

const streamTopic = new sns.Topic(apiStack, 'v1StreamTopic')

const stream = new lambda.NodejsFunction(apiStack, 'streamTopicHandler', {
	entry: url.fileURLToPath(new URL('./fn/stream/handler.ts', import.meta.url)),
	runtime: Runtime.NODEJS_20_X,
	functionName: getResourceName('streamTopicHandlerFn'),
	timeout: Duration.seconds(28),
	environment: {
		V1_CUSTOMER_TABLE: v1CustomerTable.tableName,
		V1_USER_KEYS_TABLE: v1UserKeysTable.tableName,
		V1_WEBHOOK_IP_TABLE: v1WebhookIPWhitelistTable.tableName,
		BRANCH_NAME: branchName,
	}
})

streamTopic.addSubscription(new subscriptions.LambdaSubscription(stream))
stream.addEventSource(
	new eventsources.DynamoEventSource(v1UserKeysTable, {
		startingPosition: StartingPosition.LATEST
	})
)

stream.addEventSource(
	new eventsources.DynamoEventSource(v1CustomerTable, {
		startingPosition: StartingPosition.LATEST
	})
)

stream.addEventSource(
	new eventsources.DynamoEventSource(v1WebhookIPWhitelistTable, {
		startingPosition: StartingPosition.LATEST
	})
)

v1UserKeysTable.grantReadWriteData(apiGatewayRole)
v1UserKeysTable.grantReadWriteData(customAuthorizerFn)
v1UserKeysTable.grantStreamRead(stream)

v1CustomerTable.grantReadWriteData(apiGatewayRole)
v1CustomerTable.grantStreamRead(stream)

v1WebhookIPWhitelistTable.grantReadWriteData(apiGatewayRole)
v1WebhookIPWhitelistTable.grantStreamRead(stream)

v1WebhookQueue.grantSendMessages(apiGatewayRole)
v1WebhookQueue.grantConsumeMessages(sqsV1WebhookProcessingFn)
v1GeneralQueue.grantSendMessages(apiGatewayRole)
v1GeneralQueue.grantConsumeMessages(sqsV1GeneralProcessingFn)

// Add environment variables to mainApiFn Lambda using CFN overrides
const mainApiFnLambda = backend.mainApiFn.resources.lambda.node.defaultChild as any
if (mainApiFnLambda && mainApiFnLambda.addPropertyOverride) {
	mainApiFnLambda.addPropertyOverride('Environment.Variables.V1_CUSTOMER_TABLE', v1CustomerTable.tableName)
	mainApiFnLambda.addPropertyOverride('Environment.Variables.V1_USER_KEYS_TABLE', v1UserKeysTable.tableName)
	mainApiFnLambda.addPropertyOverride('Environment.Variables.V1_WEBHOOK_IP_TABLE', v1WebhookIPWhitelistTable.tableName)
	mainApiFnLambda.addPropertyOverride('Environment.Variables.V1_WEBHOOK_QUEUE_URL', v1WebhookQueue.queueUrl)
	mainApiFnLambda.addPropertyOverride('Environment.Variables.V1_GENERAL_QUEUE_URL', v1GeneralQueue.queueUrl)
	mainApiFnLambda.addPropertyOverride('Environment.Variables.BRANCH_NAME', branchName)
}

backend.addOutput({
	custom: {
		API: {
			[loudiblyRestApi.restApiName]: {
				endpoint: loudiblyRestApi.url,
				region: Stack.of(loudiblyRestApi).region,
				apiName: loudiblyRestApi.restApiName,
			},
		},
		Queues: {
			v1WebhookQueue: v1WebhookQueue.queueUrl,
			v1GeneralQueue: v1GeneralQueue.queueUrl,
		},
		Tables: {
			v1CustomerTable: v1CustomerTable.tableName,
			v1UserKeysTable: v1UserKeysTable.tableName,
			v1WebhookIPWhitelistTable: v1WebhookIPWhitelistTable.tableName,
		}
	},
})
