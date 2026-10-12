import SavePaymentHandler from './save'
import { transactWriteItems } from '../../../utils/db'

jest.mock('../../../utils/db', () => ({ transactWriteItems: jest.fn(), queryRecord: jest.fn() }))

const user = { userId: 'user-a', role: 'user', authType: 'jwt' }
const paymentMethod = { lastFour: '4242', bin: '42424242', cardType: 'visa', cardData: 'ev:Tk9OQ:encrypted-card' }
const save = (extra: Record<string, unknown> = {}) =>
  new SavePaymentHandler().execute({ requestContext: { authorizer: user }, body: { paymentMethod, ...extra } }, {} as any)

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  ;(transactWriteItems as jest.Mock).mockResolvedValue({ success: true, res: {} })
})
afterEach(() => jest.restoreAllMocks())

describe('/payments/save handler', () => {
  it('saves the card as the signed-in user', async () => {
    const res = await save()
    expect(res!.statusCode).toBe(200)
    expect(JSON.stringify((transactWriteItems as jest.Mock).mock.calls[0][0])).toContain('"id":"user-a"')
  })

  // Regression (F3): a card could be saved under another user, who would then be charged with it
  it('answers 100053 without saving when a signed-in user names someone else', async () => {
    const res = await save({ userId: 'user-b' })
    expect(res!.statusCode).toBe(403)
    expect(JSON.parse(res!.body).error_code).toBe(100053)
    expect(transactWriteItems).not.toHaveBeenCalled()
  })
})
