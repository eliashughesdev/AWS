import accountsKyc from './routes/accounts/kyc'
import accountsDetails from './routes/accounts/details'
import accountsAccount from './routes/accounts/account'
import transferFunds from './routes/accounts/transfer'
import accountsCreate from './routes/accounts/create'
import webhookHandler from './routes/webhook/cb'
import savePayment from './routes/payments/save'
import processPayment from './routes/payments/process'
import { checkForRequiredParameters } from '../utils/params'
import { processError } from '../errors/http'

type RoutesMap = Map<string, {
    handler: any
    requiredParams: string[]
    method: string
}>

export const routes: RoutesMap = new Map([
    ['/webhook', { handler: webhookHandler, requiredParams: [], method: 'POST' }],
    ['/accounts/kyc', { handler: accountsKyc, requiredParams: [], method: 'POST' }],
    ['/accounts/details', { handler: accountsDetails, requiredParams: ['account_id'], method: 'POST' }],
    ['/accounts/account', { handler: accountsAccount, requiredParams: ['account_name'], method: 'POST' }],
    ['/accounts/transfer', { handler: transferFunds, requiredParams: ['senderAccountId', 'recipientAccountId', 'amount'], method: 'POST' }],
    ['/payments/save', { handler: savePayment, requiredParams: ['paymentMethod', 'userId'], method: 'POST' }],
    ['/payments/process', { handler: processPayment, requiredParams: ['paymentId', 'userId', 'amount', 'currency'], method: 'POST' }],
])

export const router = async (event: { body: any, path: string, httpMethod: string }, context: any) => {
    // DEBUG: Log the full incoming event object
    console.log('DEBUG: Router initiated. Incoming Event:', JSON.stringify(event));

    // Look up the route based on the path received from API Gateway
    const route = routes.get(event.path)

    if (!route) {
        // DEBUG: Route not found
        console.log(`DEBUG: Route NOT FOUND for path: ${event.path}. Available routes:`, Array.from(routes.keys()));
        return {
            statusCode: 404,
            body: JSON.stringify({ message: 'Not Found' })
        }
    }

    // DEBUG: Route found
    console.log(`DEBUG: Route FOUND: Handler=${route.handler.name}, Method=${route.method}, RequiredParams=${route.requiredParams.join(', ')}`);

    // We can also check if the method matches, though this should be handled by API Gateway configuration
    if (event.httpMethod !== route.method) {
        console.error(`ERROR: Method Mismatch. Expected: ${route.method}, Received: ${event.httpMethod}`);
        return {
            statusCode: 405, // Method Not Allowed
            body: JSON.stringify({ message: 'Method Not Allowed' })
        }
    }

    try {
        // Handle API Gateway's proxy integration where body is a string
        if (event.body && typeof event.body === 'string') {
            console.log('DEBUG: Body is a string, attempting JSON.parse...');
            event.body = JSON.parse(event.body)
        }
        console.log('DEBUG: Final Request Body:', JSON.stringify(event.body));

        // Parameter Validation
        const _check = checkForRequiredParameters(event.body, route.requiredParams)
        console.log('DEBUG: Parameter Check Result:', _check.valid ? 'Valid' : _check.message);

        if (!_check.valid) return processError(100029, _check.message)

        // Handler Execution
        console.log('DEBUG: Instantiating and executing handler...');
        const handlerInstance = new route.handler

        const response = await handlerInstance.execute(event, context)
        console.log('DEBUG: Handler execution completed successfully.');
        return response

    } catch (e) {
        // Detailed error logging
        console.error('FATAL CATCH BLOCK ERROR:', e);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal Server Error' }),
        }
    }
}
