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
import listMerchants from './routes/merchants/list'
import provisionMerchantMaster from './routes/merchants/provision-master'
import inviteMerchantMember from './routes/merchants/members-invite'
import removeMerchantMember from './routes/merchants/members-remove'
import setTreasuryPolicy from './routes/merchants/policy'
import setKycPolicy from './routes/merchants/policy-kyc'
import createTreasurySend from './routes/merchants/operations/treasury-send'
import apiKeyPermissions from './routes/accounts/api-keys/permissions'
import listApiKeys from './routes/accounts/api-keys/list'
import createApiKey from './routes/accounts/api-keys/create'
import updateApiKey from './routes/accounts/api-keys/update'
import revokeApiKey from './routes/accounts/api-keys/revoke'
import createMerchantApiKey from './routes/merchants/api-keys/create'
import listAllApiKeys from './routes/merchants/api-keys/list'
import setApiKeyRateLimit from './routes/merchants/api-keys/rate-limit'
import staffRevokeApiKey from './routes/merchants/api-keys/revoke'
import { isPublicRoute, PUBLIC_API_SURFACE } from './publicRoutes'
import { apiKeyRefusal, isApiKey, withRateHeaders } from './apiKeyChecks'
import { checkForRequiredParameters } from '../utils/params'
import { checkBodyAgainstSchema } from '../utils/schema'
import { bodyFields, describeRequest } from '../utils/requestLog'
import accountsAccountSchema from './schemas/accounts/account.json'
import accountsDetailsSchema from './schemas/accounts/details.json'
import accountsListSchema from './schemas/accounts/list.json'
import accountsKycStatusSchema from './schemas/accounts/kyc/status.json'
import accountsKycDiditSessionSchema from './schemas/accounts/kyc/didit/session.json'
import accountsKycDiditIdVerifySchema from './schemas/accounts/kyc/didit/id-verify.json'
import webhookKycDiditSchema from './schemas/webhook/kyc/didit.json'
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
import merchantsListSchema from './schemas/merchants/list.json'
import merchantsMastersProvisionSchema from './schemas/merchants/masters/provision.json'
import merchantsMembersInviteSchema from './schemas/merchants/members/invite.json'
import merchantsMembersRemoveSchema from './schemas/merchants/members/remove.json'
import merchantsPolicySchema from './schemas/merchants/policy.json'
import merchantsPolicyKycSchema from './schemas/merchants/policy/kyc.json'
import apiKeysPermissionsSchema from './schemas/accounts/api-keys/permissions.json'
import apiKeysListSchema from './schemas/accounts/api-keys/list.json'
import apiKeysCreateSchema from './schemas/accounts/api-keys/create.json'
import apiKeysUpdateSchema from './schemas/accounts/api-keys/update.json'
import apiKeysRevokeSchema from './schemas/accounts/api-keys/revoke.json'
import merchantApiKeysCreateSchema from './schemas/merchants/api-keys/create.json'
import merchantApiKeysListSchema from './schemas/merchants/api-keys/list.json'
import merchantApiKeysRateLimitSchema from './schemas/merchants/api-keys/rate-limit.json'
import merchantApiKeysRevokeSchema from './schemas/merchants/api-keys/revoke.json'
import merchantsTreasurySendSchema from './schemas/merchants/operations/treasury-send.json'
import { processError } from '../errors/http'
import { response } from '../utils/http'
import { isTemplate, matchTemplate, moreSpecificFirst, placeholdersOf } from './routeMatch'
import { idempotencyKeyOf, withIdempotency } from '../utils/idempotency'

type Route = {
  handler: any
  method: string
  allowedRoles?: ('admin' | 'user' | 'staff' | 'merchant')[]
  // For a template (/accounts/{id}): the pattern each placeholder's value must match, or the
  // request answers 100031 naming it. Every placeholder has one (router.test.ts checks)
  params?: Record<string, RegExp>
  // Takes an Idempotency-Key header (utils/idempotency.ts): 'required' refuses a request without
  // one, 'optional' runs such a request as before
  idempotency?: 'required' | 'optional'
} & (
  // A JSON schema for the body, or for a GET route the query string (amplify/service/schemas/),
  // or the older top-level-only check
  { schema: Record<string, any>, requiredParams?: never } | { requiredParams: string[], schema?: never }
)

// Each route by its path, or its path template (docs/public-api-plan.md D6.2). A path may have
// several routes, one per method
const routeList: [string, Route][] = [
  ['/webhook', { handler: webhookHandler, requiredParams: [], method: 'POST' }],
  ['/webhook/stripe', { handler: stripeWebhook, requiredParams: [], method: 'POST' }],
  ['/accounts/kyc/didit/session', { handler: accountsKycDiditSession, schema: accountsKycDiditSessionSchema, method: 'POST' }],
  ['/accounts/kyc/didit/id-verify', { handler: accountsKycDiditIdVerify, schema: accountsKycDiditIdVerifySchema, method: 'POST', allowedRoles: ['user', 'staff'] }],
  ['/webhook/kyc/didit', { handler: accountsKycWebhookDidit, schema: webhookKycDiditSchema, method: 'POST' }],
  ['/accounts/kyc/status', { handler: accountsKycStatus, schema: accountsKycStatusSchema, method: 'GET' }],
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
  ['/accounts/transfer', { handler: transferFunds, schema: accountsTransferSchema, method: 'POST', allowedRoles: ['admin', 'user'], idempotency: 'optional' }],
  ['/accounts/deposit', { handler: accountDeposit, schema: accountsDepositSchema, method: 'POST', allowedRoles: ['admin', 'user'], idempotency: 'optional' }],
  ['/accounts/withdraw', { handler: accountWithdraw, schema: accountsWithdrawSchema, method: 'POST', idempotency: 'optional' }],
  ['/payments/save', { handler: savePayment, schema: paymentsSaveSchema, method: 'POST', allowedRoles: ['user', 'admin'] }],
  ['/payments/list', { handler: listPayments, schema: paymentsListSchema, method: 'GET', allowedRoles: ['user', 'admin'] }],
  ['/payments/process', { handler: processPayment, schema: paymentsProcessSchema, method: 'POST', allowedRoles: ['user', 'admin'] }],
  ['/payments/process/guest', { handler: processGuestPayment, schema: paymentsProcessGuestSchema, method: 'POST', allowedRoles: ['user', 'admin'] }],
  ['/merchants/register', { handler: merchantRegister, schema: merchantsRegisterSchema, method: 'POST', allowedRoles: ['staff'] }],
  ['/merchants/list', { handler: listMerchants, schema: merchantsListSchema, method: 'GET', allowedRoles: ['staff'] }],
  ['/merchants/masters/provision', { handler: provisionMerchantMaster, schema: merchantsMastersProvisionSchema, method: 'POST', allowedRoles: ['staff'] }],
  ['/merchants/members/invite', { handler: inviteMerchantMember, schema: merchantsMembersInviteSchema, method: 'POST', allowedRoles: ['staff'] }],
  ['/merchants/members/remove', { handler: removeMerchantMember, schema: merchantsMembersRemoveSchema, method: 'POST', allowedRoles: ['staff'] }],
  ['/merchants/policy', { handler: setTreasuryPolicy, schema: merchantsPolicySchema, method: 'POST', allowedRoles: ['staff'] }],
  ['/merchants/policy/kyc', { handler: setKycPolicy, schema: merchantsPolicyKycSchema, method: 'POST', allowedRoles: ['staff'] }],
  // API keys (docs/public-api-plan.md D2.6): a user's own, and staff for every key. Signed-in
  // sessions only (100057); never on the public API
  ['/accounts/api-keys/permissions', { handler: apiKeyPermissions, schema: apiKeysPermissionsSchema, method: 'GET' }],
  ['/accounts/api-keys/list', { handler: listApiKeys, schema: apiKeysListSchema, method: 'GET' }],
  ['/accounts/api-keys/create', { handler: createApiKey, schema: apiKeysCreateSchema, method: 'POST' }],
  ['/accounts/api-keys/update', { handler: updateApiKey, schema: apiKeysUpdateSchema, method: 'POST' }],
  ['/accounts/api-keys/revoke', { handler: revokeApiKey, schema: apiKeysRevokeSchema, method: 'POST' }],
  ['/merchants/api-keys/create', { handler: createMerchantApiKey, schema: merchantApiKeysCreateSchema, method: 'POST', allowedRoles: ['staff'] }],
  ['/merchants/api-keys/list', { handler: listAllApiKeys, schema: merchantApiKeysListSchema, method: 'GET', allowedRoles: ['staff'] }],
  ['/merchants/api-keys/rate-limit', { handler: setApiKeyRateLimit, schema: merchantApiKeysRateLimitSchema, method: 'POST', allowedRoles: ['staff'] }],
  ['/merchants/api-keys/revoke', { handler: staffRevokeApiKey, schema: merchantApiKeysRevokeSchema, method: 'POST', allowedRoles: ['staff'] }],
  ['/merchants/operations/treasury-send', { handler: createTreasurySend, schema: merchantsTreasurySendSchema, method: 'POST', allowedRoles: ['merchant'] }],
]

export type RegisteredRoute = Route & { path: string }

const routeKey = (method: string, path: string) => `${method} ${path}`

// By `<METHOD> <path>`, e.g. `POST /accounts/withdraw` or `GET /accounts/{id}`
export const routes = new Map<string, RegisteredRoute>(
  routeList.map(([path, route]) => [routeKey(route.method, path), { ...route, path }])
)

// The route a path names: with this method; or on another method only (allowed lists them, for a
// 405); or none. A path the router knows as it is wins over every template
export const findRoute = (path: string, method: string):
  | { route: RegisteredRoute, params: Record<string, string> }
  | { route?: never, allowed: string[] }
  | undefined => {
  const exact = routes.get(routeKey(method, path))
  if (exact) return { route: exact, params: {} }

  const onPath = [...routes.values()].filter(route => route.path === path)
  if (onPath.length) return { allowed: onPath.map(route => route.method) }

  const fitting = [...routes.values()].filter(route => isTemplate(route.path) && matchTemplate(route.path, path))
  if (!fitting.length) return undefined
  const best = fitting.map(route => route.path).sort(moreSpecificFirst)[0]
  const route = fitting.find(candidate => candidate.path === best && candidate.method === method)
  if (!route) return { allowed: fitting.filter(candidate => candidate.path === best).map(candidate => candidate.method) }
  return { route, params: matchTemplate(route.path, path)! }
}

// The route at a path, the first registered when no method is given (tests stub its handler)
export const routeAt = (path: string, method?: string) =>
  [...routes.values()].find(route => route.path === path && (!method || route.method === method))

// Whose namespace an Idempotency-Key lives in: the signed-in user, or the merchant of a key. An API
// key shares its owner's: the same user or merchant, whichever credential they sent
const idempotencyScope = (authorizer: Record<string, string> | undefined) => {
  if (!authorizer?.authType) return undefined
  const merchantKey = authorizer.authType === 'key' || (authorizer.authType === 'apikey' && authorizer.ownerType === 'merchant')
  const userKey = authorizer.authType === 'apikey' && authorizer.ownerType === 'user'
  const who = merchantKey ? authorizer.merchantId : authorizer.userId
  const kind = merchantKey ? 'key' : userKey ? 'jwt' : authorizer.authType
  return who ? `${kind}:${who}` : undefined
}

// Checks a template's captured values against its route's patterns: the name of the first that
// does not match, or undefined
const badParam = (route: RegisteredRoute, params: Record<string, string>) =>
  placeholdersOf(route.path).find(name => !route.params?.[name]?.test(params[name]))

export const router = async (event: { body: any, path: string, httpMethod: string, stageVariables?: Record<string, string | undefined> | null, queryStringParameters?: Record<string, string | undefined> | null }, context: any) => {
  // Never the event itself: its body and headers carry passwords, tokens and credentials
  console.log('DEBUG: Router initiated:', JSON.stringify(describeRequest(event)))

  // Look up the route based on the path received from API Gateway
  // Custom-domain requests arrive as /v1/<route>; direct execute-api calls as /<route>.
  const routePath = event.path.replace(/^\/v1(?=\/)/, '')
  const found = findRoute(routePath, event.httpMethod)
  const route = found?.route

  // The public API has a resource for its routes only; this keeps it that way
  // if a resource is ever added there by mistake. A template is public by its template
  const viaPublicApi = event.stageVariables?.API_SURFACE === PUBLIC_API_SURFACE
  const isPublic = route
    ? isPublicRoute(route.path, route.method)
    : found?.allowed.some(method => isPublicRoute(routePath, method))
  if (found && viaPublicApi && !isPublic) {
    console.log(`DEBUG: Route ${routePath} is not public, refused on the public API`)
    return response({ statusCode: 404, headers: null, bodyObject: { message: 'Not Found' } })
  }

  // We can also check if the method matches, though this should be handled by API Gateway configuration
  if (found && !route) {
    console.error(`ERROR: Method Mismatch. Expected: ${found.allowed.join(', ')}, Received: ${event.httpMethod}`)
    return response({ statusCode: 405, headers: null, bodyObject: { message: 'Method Not Allowed' } })
  }

  if (!route) {
    // DEBUG: Route not found
    console.log(`DEBUG: Route NOT FOUND for path: ${event.path}. Available routes:`, Array.from(routes.keys()))
    return response({ statusCode: 404, headers: null, bodyObject: { message: 'Not Found' } })
  }

  // DEBUG: Route found
  console.log(`DEBUG: Route FOUND: Handler=${route.handler.name}, Method=${route.method}, ${route.schema ? `Schema=${route.schema.title}` : `RequiredParams=${route.requiredParams.join(', ')}`}`)

  // An API key: public API only, within its rate limit, holding the route's permission (D2.4)
  const authorizer = (event as any).requestContext?.authorizer
  if (isApiKey(authorizer)) {
    const refusal = apiKeyRefusal(authorizer, route, viaPublicApi)
    if (refusal) return refusal
    return withRateHeaders(await runRoute(event, context, route, found!.params!), authorizer)
  }
  return runRoute(event, context, route, found!.params!)
}

// Body, roles, path values, schema, then the handler (behind its Idempotency-Key when it has one)
const runRoute = async (event: any, context: any, route: RegisteredRoute, params: Record<string, string>) => {
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

    // A template's values: checked against its patterns, then handed to the handler as
    // pathParameters (API Gateway's own are { proxy } on the internal API)
    if (isTemplate(route.path)) {
      const bad = badParam(route, params)
      if (bad) return processError(100031, bad)
      ;(event as any).pathParameters = params
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
    const run = () => new route.handler().execute(event, context)
    const scope = idempotencyScope((event as any).requestContext?.authorizer)
    // With no caller to scope a key to, the route runs as it always did
    const result = route.idempotency && scope
      ? await withIdempotency({
        caller: scope,
        key: idempotencyKeyOf((event as any).headers),
        method: route.method,
        path: route.path,
        body: event.body,
        required: route.idempotency === 'required',
        run,
      })
      : await run()
    console.log('DEBUG: Handler execution completed successfully.')
    return result
  } catch (e) {
    // Detailed error logging
    console.error('FATAL CATCH BLOCK ERROR:', e)
    return response({ statusCode: 500, headers: null, bodyObject: { message: 'Internal Server Error' } })
  }
}
