import accountsKycDiditSession from './routes/accounts/kyc-didit-session'
import accountsKycWebhookDidit from './routes/accounts/kyc-webhook-didit'
import accountsKycDiditIdVerify from './routes/accounts/kyc-didit-id-verify'
import accountsKycStatus from './routes/accounts/kyc-status'
import accountsDetails from './routes/accounts/details'
import accountsAccount from './routes/accounts/account'
import accountsList from './routes/accounts/list'
import transferFunds from './routes/accounts/transfer'
import accountsCreate from './routes/accounts/create'
import accountDeposit from './routes/accounts/deposit'
import accountWithdraw from './routes/accounts/withdraw'
import webhookHandler from './routes/webhook/cb'
import stripeWebhook from './routes/webhook/stripe'
import savePayment from './routes/payments/save'
import listPayments from './routes/payments/list'
import processPayment from './routes/payments/process'
import processGuestPayment from './routes/payments/processGuest'
import { checkForRequiredParameters } from '../utils/params'
import { processError } from '../errors/http'

type RoutesMap = Map<string, {
  handler: any
  requiredParams: string[]
  method: string
  allowedRoles?: ('admin' | 'user')[]
}>

export const routes: RoutesMap = new Map([
  ['/webhook', { handler: webhookHandler, requiredParams: [], method: 'POST' }],
  ['/webhook/stripe', { handler: stripeWebhook, requiredParams: [], method: 'POST' }],
  ['/accounts/kyc/didit/session', { handler: accountsKycDiditSession, requiredParams: [], method: 'POST' }],
  ['/accounts/kyc/didit/id-verify', { handler: accountsKycDiditIdVerify, requiredParams: [], method: 'POST' }],
  ['/webhook/kyc/didit', { handler: accountsKycWebhookDidit, requiredParams: [], method: 'POST' }],
  ['/accounts/kyc/status', { handler: accountsKycStatus, requiredParams: [], method: 'GET' }],
  ['/accounts/list', { handler: accountsList, requiredParams: [], method: 'GET' }],
  ['/accounts/details', { handler: accountsDetails, requiredParams: ['account_id'], method: 'POST' }],
  ['/accounts/account', { handler: accountsAccount, requiredParams: ['account_name'], method: 'POST' }],
  ['/accounts/transfer', { handler: transferFunds, requiredParams: ['senderAccountNumber', 'recipientAccountNumber', 'amount'], method: 'POST', allowedRoles: ['admin'] }],
  ['/accounts/deposit', { handler: accountDeposit, requiredParams: ['accountNumber', 'currency', 'amount', 'paymentId', 'userId'], method: 'POST', allowedRoles: ['admin', 'user'] }],
  ['/accounts/withdraw', { handler: accountWithdraw, requiredParams: ['accountNumber', 'currency', 'amount', 'userId', 'destinationAddress'], method: 'POST' }],
  ['/payments/save', { handler: savePayment, requiredParams: ['paymentMethod', 'userId'], method: 'POST' }],
  ['/payments/list', { handler: listPayments, requiredParams: [], method: 'GET' }],
  ['/payments/process', { handler: processPayment, requiredParams: ['paymentId', 'userId', 'amount', 'currency'], method: 'POST' }],
  ['/payments/process/guest', { handler: processGuestPayment, requiredParams: ['cardData', 'userId', 'amount', 'currency'], method: 'POST' }],
])

export const router = async (event: { body: any, path: string, httpMethod: string }, context: any) => {
  // DEBUG: Log the full incoming event object
  console.log('DEBUG: Router initiated. Incoming Event:', JSON.stringify(event))

  // Look up the route based on the path received from API Gateway
  const route = routes.get(event.path)

  if (!route) {
    // DEBUG: Route not found
    console.log(`DEBUG: Route NOT FOUND for path: ${event.path}. Available routes:`, Array.from(routes.keys()))
    return {
      statusCode: 404,
      body: JSON.stringify({ message: 'Not Found' })
    }
  }

  // DEBUG: Route found
  console.log(`DEBUG: Route FOUND: Handler=${route.handler.name}, Method=${route.method}, RequiredParams=${route.requiredParams.join(', ')}`)

  // We can also check if the method matches, though this should be handled by API Gateway configuration
  if (event.httpMethod !== route.method) {
    console.error(`ERROR: Method Mismatch. Expected: ${route.method}, Received: ${event.httpMethod}`)
    return {
      statusCode: 405, // Method Not Allowed
      body: JSON.stringify({ message: 'Method Not Allowed' })
    }
  }

  try {
    // Preserve raw body before parsing (needed for Stripe webhook signature verification)
    const rawBody = event.body

    // Handle API Gateway's proxy integration where body is a string
    if (event.body && typeof event.body === 'string') {
      console.log('DEBUG: Body is a string, attempting JSON.parse...')
      event.body = JSON.parse(event.body)
    }

    // Attach raw body to event for handlers that need it (e.g. Stripe webhooks)
    ;(event as any).rawBody = rawBody
    console.log('DEBUG: Final Request Body:', JSON.stringify(event.body))

    // RBAC: enforce allowedRoles if defined on the route
    if (route.allowedRoles) {
      const role = (event as any).requestContext?.authorizer?.role
      console.log('DEBUG: RBAC check — route allowedRoles:', route.allowedRoles, 'caller role:', role)
      if (!route.allowedRoles.includes(role)) {
        console.log('DEBUG: RBAC denied for role:', role)
        return { statusCode: 403, body: JSON.stringify({ message: 'Forbidden' }) }
      }
    }

    // Parameter Validation
    const _check = checkForRequiredParameters(event.body, route.requiredParams)
    console.log('DEBUG: Parameter Check Result:', _check.valid ? 'Valid' : _check.message)

    if (!_check.valid) return processError(100029, _check.message)

    // Handler Execution
    console.log('DEBUG: Instantiating and executing handler...')
    const handlerInstance = new route.handler()

    const response = await handlerInstance.execute(event, context)
    console.log('DEBUG: Handler execution completed successfully.')
    return response
  } catch (e) {
    // Detailed error logging
    console.error('FATAL CATCH BLOCK ERROR:', e)
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal Server Error' }),
    }
  }
}
