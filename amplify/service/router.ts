import accountsKycDiditSession from './routes/accounts/kyc-didit-session'
import accountsKycWebhookDidit from './routes/accounts/kyc-webhook-didit'
import accountsKycDiditIdVerify from './routes/accounts/kyc-didit-id-verify'
import accountsKycStatus from './routes/accounts/kyc-status'
import accountsDetails from './routes/accounts/details'
import accountsAccount from './routes/accounts/account'
import accountsList from './routes/accounts/list'
import accountsRename from './routes/accounts/rename'
import accountsProfile from './routes/accounts/profile'
import accountsProfileSave from './routes/accounts/profile-save'
import accountsTransactions from './routes/accounts/transactions'
import transferFunds from './routes/accounts/transfer'
import accountsOnboarding from './routes/accounts/onboarding'
import accountsOnboardingResend from './routes/accounts/onboarding-resend'
import onboardingVerify from './routes/onboarding/verify'
import onboardingClaim from './routes/onboarding/claim'
import accountDeposit from './routes/accounts/deposit'
import accountWithdraw from './routes/accounts/withdraw'
import webhookHandler from './routes/webhook/cb'
import stripeWebhook from './routes/webhook/stripe'
import savePayment from './routes/payments/save'
import listPayments from './routes/payments/list'
import processPayment from './routes/payments/process'
import processGuestPayment from './routes/payments/processGuest'
import merchantRegister from './routes/merchants/register'
import provisionMerchantMaster from './routes/merchants/provision-master'
import inviteMerchantMember from './routes/merchants/members-invite'
import removeMerchantMember from './routes/merchants/members-remove'
import setTreasuryPolicy from './routes/merchants/policy'
import createTreasurySend from './routes/merchants/operations/treasury-send'
import { isPublicRoute, PUBLIC_API_SURFACE } from './publicRoutes'
import { checkForRequiredParameters } from '../utils/params'
import { checkBodyAgainstSchema } from '../utils/schema'
import { bodyFields, describeRequest } from '../utils/requestLog'
import accountsAccountSchema from './schemas/accounts/account.json'
import accountsDetailsSchema from './schemas/accounts/details.json'
import accountsListSchema from './schemas/accounts/list.json'
import accountsRenameSchema from './schemas/accounts/rename.json'
import accountsProfileSchema from './schemas/accounts/profile.json'
import accountsProfileSaveSchema from './schemas/accounts/profile/save.json'
import accountsTransactionsSchema from './schemas/accounts/transactions.json'
import accountsTransferSchema from './schemas/accounts/transfer.json'
import accountsDepositSchema from './schemas/accounts/deposit.json'
import accountsWithdrawSchema from './schemas/accounts/withdraw.json'
import paymentsSaveSchema from './schemas/payments/save.json'
import paymentsListSchema from './schemas/payments/list.json'
import paymentsProcessSchema from './schemas/payments/process.json'
import paymentsProcessGuestSchema from './schemas/payments/process/guest.json'
import accountsOnboardingSchema from './schemas/accounts/onboarding.json'
import accountsOnboardingResendSchema from './schemas/accounts/onboarding/resend.json'
import onboardingVerifySchema from './schemas/onboarding/verify.json'
import onboardingClaimSchema from './schemas/onboarding/claim.json'
import merchantsRegisterSchema from './schemas/merchants/register.json'
import merchantsMastersProvisionSchema from './schemas/merchants/masters/provision.json'
import merchantsMembersInviteSchema from './schemas/merchants/members/invite.json'
import merchantsMembersRemoveSchema from './schemas/merchants/members/remove.json'
import merchantsPolicySchema from './schemas/merchants/policy.json'
import merchantsTreasurySendSchema from './schemas/merchants/operations/treasury-send.json'
import { processError } from '../errors/http'
import { response } from '../utils/http'

type RoutesMap = Map<string, {
  handler: any
  method: string
  allowedRoles?: ('admin' | 'user' | 'staff' | 'merchant')[]
} & (
  // A JSON schema for the body, or for a GET route the query string (amplify/service/schemas/),
  // or the older top-level-only check
  { schema: Record<string, any>, requiredParams?: never } | { requiredParams: string[], schema?: never }
)>

export const routes: RoutesMap = new Map([
  ['/webhook', { handler: webhookHandler, requiredParams: [], method: 'POST' }],
  ['/webhook/stripe', { handler: stripeWebhook, requiredParams: [], method: 'POST' }],
  ['/accounts/kyc/didit/session', { handler: accountsKycDiditSession, requiredParams: [], method: 'POST' }],
  ['/accounts/kyc/didit/id-verify', { handler: accountsKycDiditIdVerify, requiredParams: [], method: 'POST' }],
  ['/webhook/kyc/didit', { handler: accountsKycWebhookDidit, requiredParams: [], method: 'POST' }],
  ['/accounts/kyc/status', { handler: accountsKycStatus, requiredParams: [], method: 'GET' }],
  ['/accounts/list', { handler: accountsList, schema: accountsListSchema, method: 'GET' }],
  ['/accounts/profile', { handler: accountsProfile, schema: accountsProfileSchema, method: 'GET' }],
  ['/accounts/profile/save', { handler: accountsProfileSave, schema: accountsProfileSaveSchema, method: 'POST' }],
  ['/accounts/transactions', { handler: accountsTransactions, schema: accountsTransactionsSchema, method: 'POST' }],
  ['/accounts/details', { handler: accountsDetails, schema: accountsDetailsSchema, method: 'POST' }],
  ['/accounts/account', { handler: accountsAccount, schema: accountsAccountSchema, method: 'POST' }],
  ['/accounts/rename', { handler: accountsRename, schema: accountsRenameSchema, method: 'POST' }],
  ['/accounts/onboarding', { handler: accountsOnboarding, schema: accountsOnboardingSchema, method: 'POST', allowedRoles: ['admin'] }],
  ['/accounts/onboarding/resend', { handler: accountsOnboardingResend, schema: accountsOnboardingResendSchema, method: 'POST', allowedRoles: ['admin'] }],
  // Unauthenticated: the payer has no session yet — the one-time token is the credential.
  ['/onboarding/verify', { handler: onboardingVerify, schema: onboardingVerifySchema, method: 'POST' }],
  ['/onboarding/claim', { handler: onboardingClaim, schema: onboardingClaimSchema, method: 'POST' }],
  ['/accounts/transfer', { handler: transferFunds, schema: accountsTransferSchema, method: 'POST', allowedRoles: ['admin', 'user'] }],
  ['/accounts/deposit', { handler: accountDeposit, schema: accountsDepositSchema, method: 'POST', allowedRoles: ['admin', 'user'] }],
  ['/accounts/withdraw', { handler: accountWithdraw, schema: accountsWithdrawSchema, method: 'POST' }],
  ['/payments/save', { handler: savePayment, schema: paymentsSaveSchema, method: 'POST', allowedRoles: ['user', 'admin'] }],
  ['/payments/list', { handler: listPayments, schema: paymentsListSchema, method: 'GET', allowedRoles: ['user', 'admin'] }],
  ['/payments/process', { handler: processPayment, schema: paymentsProcessSchema, method: 'POST', allowedRoles: ['user', 'admin'] }],
  ['/payments/process/guest', { handler: processGuestPayment, schema: paymentsProcessGuestSchema, method: 'POST', allowedRoles: ['user', 'admin'] }],
  ['/merchants/register', { handler: merchantRegister, schema: merchantsRegisterSchema, method: 'POST', allowedRoles: ['staff'] }],
  ['/merchants/masters/provision', { handler: provisionMerchantMaster, schema: merchantsMastersProvisionSchema, method: 'POST', allowedRoles: ['staff'] }],
  ['/merchants/members/invite', { handler: inviteMerchantMember, schema: merchantsMembersInviteSchema, method: 'POST', allowedRoles: ['staff'] }],
  ['/merchants/members/remove', { handler: removeMerchantMember, schema: merchantsMembersRemoveSchema, method: 'POST', allowedRoles: ['staff'] }],
  ['/merchants/policy', { handler: setTreasuryPolicy, schema: merchantsPolicySchema, method: 'POST', allowedRoles: ['staff'] }],
  ['/merchants/operations/treasury-send', { handler: createTreasurySend, schema: merchantsTreasurySendSchema, method: 'POST', allowedRoles: ['merchant'] }],
])

export const router = async (event: { body: any, path: string, httpMethod: string, stageVariables?: Record<string, string | undefined> | null, queryStringParameters?: Record<string, string | undefined> | null }, context: any) => {
  // Never the event itself: its body and headers carry passwords, tokens and credentials
  console.log('DEBUG: Router initiated:', JSON.stringify(describeRequest(event)))

  // Look up the route based on the path received from API Gateway
  // Custom-domain requests arrive as /v1/<route>; direct execute-api calls as /<route>.
  const routePath = event.path.replace(/^\/v1(?=\/)/, '')
  const route = routes.get(routePath)

  // The public API has a resource for its routes only; this keeps it that way
  // if a resource is ever added there by mistake
  const viaPublicApi = event.stageVariables?.API_SURFACE === PUBLIC_API_SURFACE
  if (route && viaPublicApi && !isPublicRoute(routePath, event.httpMethod)) {
    console.log(`DEBUG: Route ${routePath} is not public, refused on the public API`)
    return response({ statusCode: 404, headers: null, bodyObject: { message: 'Not Found' } })
  }

  if (!route) {
    // DEBUG: Route not found
    console.log(`DEBUG: Route NOT FOUND for path: ${event.path}. Available routes:`, Array.from(routes.keys()))
    return response({ statusCode: 404, headers: null, bodyObject: { message: 'Not Found' } })
  }

  // DEBUG: Route found
  console.log(`DEBUG: Route FOUND: Handler=${route.handler.name}, Method=${route.method}, ${route.schema ? `Schema=${route.schema.title}` : `RequiredParams=${route.requiredParams.join(', ')}`}`)

  // We can also check if the method matches, though this should be handled by API Gateway configuration
  if (event.httpMethod !== route.method) {
    console.error(`ERROR: Method Mismatch. Expected: ${route.method}, Received: ${event.httpMethod}`)
    return response({ statusCode: 405, headers: null, bodyObject: { message: 'Method Not Allowed' } })
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
    console.log('DEBUG: Request body fields:', bodyFields(event.body))

    // RBAC: enforce allowedRoles if defined on the route
    if (route.allowedRoles) {
      const role = (event as any).requestContext?.authorizer?.role
      console.log('DEBUG: RBAC check — route allowedRoles:', route.allowedRoles, 'caller role:', role)
      if (!route.allowedRoles.includes(role)) {
        console.log('DEBUG: RBAC denied for role:', role)
        return response({ statusCode: 403, headers: null, bodyObject: { message: 'Forbidden' } })
      }
    }

    // Parameter Validation
    if (route.schema) {
      // A GET has no body: its schema describes the query string
      const input = route.method === 'GET' ? event.queryStringParameters ?? {} : event.body
      const _check = checkBodyAgainstSchema(input, route.schema)
      console.log('DEBUG: Schema Check Result:', _check.valid ? 'Valid' : `${_check.code} ${_check.message}`)

      if (!_check.valid) return processError(_check.code, _check.message)
    } else {
      const _check = checkForRequiredParameters(event.body, route.requiredParams)
      console.log('DEBUG: Parameter Check Result:', _check.valid ? 'Valid' : _check.message)

      if (!_check.valid) return processError(100029, _check.message)
    }

    // Handler Execution
    console.log('DEBUG: Instantiating and executing handler...')
    const handlerInstance = new route.handler()

    const result = await handlerInstance.execute(event, context)
    console.log('DEBUG: Handler execution completed successfully.')
    return result
  } catch (e) {
    // Detailed error logging
    console.error('FATAL CATCH BLOCK ERROR:', e)
    return response({ statusCode: 500, headers: null, bodyObject: { message: 'Internal Server Error' } })
  }
}
