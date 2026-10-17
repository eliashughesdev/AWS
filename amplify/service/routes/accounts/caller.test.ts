import { queryItemFromIndex, queryRecord, updateItem, putItem, getRecord, transactWriteItems } from '../../../utils/db'
import { getMerchant } from '../../../utils/merchant'
import AccountsListHandler from './list'
import AccountHandler from './account'
import AccountsRenameHandler from './rename'
import DetailsHandler from './details'
import TransactionsHandler from './transactions'
import TransferFundsHandler from './transfer'
import DepositHandler from './deposit'
import WithdrawHandler from './withdraw'
import ProfileHandler from './profile'
import ProfileSaveHandler from './profile-save'
import KycStatusHandler from './kyc-status'
import KycDiditSessionHandler from './kyc-didit-session'
import OnboardingHandler from './onboarding'
import OnboardingResendHandler from './onboarding-resend'

jest.mock('../../../utils/db')
jest.mock('../../../utils/sqs')
jest.mock('../../../utils/merchant')
jest.mock('../../../utils/cognito')
jest.mock('../../../utils/custodialAccount')
jest.mock('../../../utils/claimInvite')

// The contexts fn/authorizer/handler.js gives a merchant's HMAC key and a signed-in person
const hmac = { userId: 'merchant-1', role: 'admin', authType: 'key', merchantId: 'merchant-1' }
const jwtAdmin = { userId: 'sub-1', role: 'admin', authType: 'jwt' }

const accountNumber = 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4'
const recipient = 'PCF0001aaaabbbbccccddddeeeeffff0000111122'

const userRoutes: [string, { execute: (event: any, context?: any) => Promise<any> }, Record<string, unknown>][] = [
  ['/accounts/list', new AccountsListHandler(), {}],
  ['/accounts/account', new AccountHandler(), { chain: 'TRON', provider: 'PCF0001', email: 'a@b.co', accountingCurrency: 'USD' }],
  ['/accounts/rename', new AccountsRenameHandler(), { accountNumber, name: 'Savings' }],
  ['/accounts/details', new DetailsHandler(), { accountNumber }],
  ['/accounts/transactions', new TransactionsHandler(), { accountNumber }],
  ['/accounts/transfer', new TransferFundsHandler(), { provider: 'PCF0001', senderAccountNumber: accountNumber, recipientAccountNumber: recipient, amount: '1' }],
  ['/accounts/deposit', new DepositHandler(), { accountNumber, currency: 'USD', amount: 10, paymentId: 'pm-1' }],
  ['/accounts/withdraw', new WithdrawHandler(), { accountNumber, currency: 'TRON', cryptoAmount: 1, destinationAddress: 'T-address' }],
  ['/accounts/profile', new ProfileHandler(), {}],
  ['/accounts/profile/save', new ProfileSaveHandler(), { name: 'Ann' }],
  ['/accounts/kyc/status', new KycStatusHandler(), {}],
  ['/accounts/kyc/didit/session', new KycDiditSessionHandler(), {}],
]

const dbCalls = () => [queryItemFromIndex, queryRecord, updateItem, putItem, getRecord, transactWriteItems]
  .reduce((n, fn) => n + jest.mocked(fn).mock.calls.length, 0)

// docs/public-api-plan.md step 1.1: these read authorizer.userId, which a merchant's HMAC key
// sets to the merchant id, so a signed request acted on a "user" whose id is the merchant's
describe.each(userRoutes)('%s with a merchant\'s HMAC key', (_path, handler, body) => {
  it('answers 100053 and reads or writes nothing', async () => {
    const res = await handler.execute({ body, requestContext: { authorizer: hmac } }, {} as any)
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error_code).toBe(100053)
    expect(dbCalls()).toBe(0)
  })
})

describe('/accounts/account', () => {
  // It made up a user id when there was none, creating an account nobody could sign in to
  it('creates nothing without a signed-in user', async () => {
    const res = await new AccountHandler().execute({ body: userRoutes[1][2], requestContext: {} }, {} as any)
    expect(res.statusCode).toBe(403)
    expect(dbCalls()).toBe(0)
  })
})

const onboardingBody = {
  externalId: 'ext-1',
  firstName: 'Ann',
  lastName: 'Lee',
  email: 'ann@example.com',
  chain: 'TRON',
  transaction: { id: 'tx-1', amount: 10, currency: 'USD' },
}

describe('/accounts/onboarding', () => {
  it('takes the merchant from an HMAC key, as before', async () => {
    jest.mocked(getMerchant).mockResolvedValue({ success: true, res: { status: 'inactive' } } as any)
    const res = await new OnboardingHandler().execute({ body: onboardingBody, requestContext: { authorizer: hmac } } as any, {} as any)
    expect(getMerchant).toHaveBeenCalledWith('merchant-1')
    expect(JSON.parse(res.body).error_code).toBe(100040)
  })

  it('refuses a signed-in person, the Cognito group admin included', async () => {
    const res = await new OnboardingHandler().execute({ body: onboardingBody, requestContext: { authorizer: jwtAdmin } } as any, {} as any)
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error_code).toBe(100053)
    expect(getMerchant).not.toHaveBeenCalled()
  })
})

describe('/accounts/onboarding/resend', () => {
  it('looks the payer up under the merchant of the HMAC key, as before', async () => {
    jest.mocked(queryRecord).mockResolvedValue({ success: true, res: [] })
    await new OnboardingResendHandler().execute({ body: { externalId: 'ext-1' }, requestContext: { authorizer: hmac } } as any, {} as any)
    expect(queryRecord).toHaveBeenCalledWith('v2CustomerTable', expect.any(String), expect.objectContaining({ ':id': 'EXT#merchant-1#ext-1' }))
  })

  it('refuses a signed-in person', async () => {
    const res = await new OnboardingResendHandler().execute({ body: { externalId: 'ext-1' }, requestContext: { authorizer: jwtAdmin } } as any, {} as any)
    expect(res.statusCode).toBe(403)
    expect(queryRecord).not.toHaveBeenCalled()
  })
})
