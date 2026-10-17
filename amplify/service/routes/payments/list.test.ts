import ListPaymentsHandler from './list'
import { queryRecord } from '../../../utils/db'

jest.mock('../../../utils/db', () => ({ queryRecord: jest.fn() }))

const user = { userId: 'user-a', role: 'user', authType: 'jwt' }
const list = (authorizer: Record<string, string>, query: Record<string, string> | null) =>
  new ListPaymentsHandler().execute({ requestContext: { authorizer }, queryStringParameters: query }, {} as any)

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  ;(queryRecord as jest.Mock).mockResolvedValue({ success: true, res: [{ id: 'user-a', sk: 'PAYMENT#card-1', cardData: { lastFour: '4242' } }] })
})
afterEach(() => jest.restoreAllMocks())

describe('/payments/list handler', () => {
  it.each([
    ['no query string', null],
    ['their own userId', { userId: 'user-a' }],
  ])('lists a signed-in user\'s own cards for %s', async (_, query) => {
    const res = await list(user, query)
    expect(JSON.parse(res.body).res).toMatchObject([{ id: 'card-1', lastFour: '4242' }])
    expect(queryRecord).toHaveBeenCalledWith('v2CustomerTable', expect.any(String), expect.objectContaining({ ':userId': 'user-a' }))
  })

  // Regression (F3): any signed-in user could list another user's cards, and with their ids charge them
  it('answers 100053 without reading cards when a signed-in user names someone else', async () => {
    const res = await list(user, { userId: 'user-b' })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error_code).toBe(100053)
    expect(queryRecord).not.toHaveBeenCalled()
  })
})
