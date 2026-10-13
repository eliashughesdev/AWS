import ListRequestsHandler from './list'
import { queryRecord, updateItem } from '../../../../utils/db'

jest.mock('../../../../utils/db', () => ({ queryRecord: jest.fn(), updateItem: jest.fn() }))
const mockQuery = jest.mocked(queryRecord)
const mockUpdate = jest.mocked(updateItem)

const HOUR = 60 * 60 * 1000
const soon = new Date(Date.now() + HOUR).toISOString()

const request = (requestId: string, change: Record<string, any> = {}) => ({
  id: 'mrc_a',
  sk: `REQ#${requestId}`,
  requestId,
  merchantId: 'mrc_a',
  type: 'TREASURY_SEND',
  currency: 'USDT_TRON',
  amount: 250,
  destinationAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  initiatorId: 'maker',
  approvers: ['ana', 'ben'],
  requiredCount: 2,
  votes: {},
  approvalCount: 0,
  status: 'PENDING',
  expiresAt: soon,
  createdAt: '2026-10-13T10:00:00.000Z',
  ...change,
})

const member = (userId: string, change: Record<string, any> = {}) => [
  { id: `USER#${userId}`, sk: 'MEMBERSHIP', merchantId: 'mrc_a' },
  { id: 'mrc_a', sk: `MEMBER#${userId}`, userId, roles: ['initiator'], status: 'active', ...change },
  { id: 'mrc_a', sk: 'PROFILE', status: 'active' },
]

// The caller's rows by key, and `requests` for the one query that reads the REQ# rows
const table = (caller: Record<string, any>[], requests: Record<string, any>[] | null) =>
  mockQuery.mockImplementation(async (_table, _expression, values) => ':p' in values
    ? { success: requests !== null, res: requests }
    : { success: true, res: caller.filter(row => row.id === values[':id'] && row.sk === values[':sk']) })

const list = async (userId: string) => {
  const res = await new ListRequestsHandler().execute({ requestContext: { authorizer: { userId } } }, {} as any)
  return { statusCode: res.statusCode, body: JSON.parse(res.body) }
}

describe('GET /merchants/operations/list', () => {
  beforeEach(() => {
    mockUpdate.mockResolvedValue({ success: true, res: {} as any, error: null })
  })

  // Read backwards with a limit: read forwards, the oldest requests would fill the page
  it('reads the newest requests of the caller\'s own merchant', async () => {
    table(member('maker'), [])
    await list('maker')
    expect(mockQuery).toHaveBeenCalledWith('v1MerchantTable', 'id = :id AND begins_with(sk, :p)', { ':id': 'mrc_a', ':p': 'REQ#' }, false, { descending: true, limit: 100 })
  })

  it('answers each request in the order read, its votes as a list', async () => {
    const votes = { ana: { decision: 'approve', at: '2026-10-13T11:00:00.000Z' } }
    table(member('maker'), [
      request('req_1760000000002_0123456789ab', { approvalCount: 1, votes }),
      request('req_1760000000001_0123456789ab', { status: 'CANCELLED', cancelReason: 'MEMBER_REMOVED', updatedAt: 'later' }),
    ])

    const { statusCode, body } = await list('maker')

    expect(statusCode).toBe(200)
    expect(body.requests).toEqual([
      {
        requestId: 'req_1760000000002_0123456789ab',
        type: 'TREASURY_SEND',
        currency: 'USDT_TRON',
        amount: 250,
        destinationAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        status: 'PENDING',
        cancelReason: null,
        initiatorId: 'maker',
        approvers: ['ana', 'ben'],
        requiredCount: 2,
        approvalCount: 1,
        votes: [{ userId: 'ana', decision: 'approve', at: '2026-10-13T11:00:00.000Z' }],
        expiresAt: soon,
        createdAt: '2026-10-13T10:00:00.000Z',
      },
      expect.objectContaining({ requestId: 'req_1760000000001_0123456789ab', status: 'CANCELLED', cancelReason: 'MEMBER_REMOVED', votes: [] }),
    ])
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  // The client never works out an expiry: the answer says EXPIRED, and so does the row from now on
  it('answers EXPIRED for a pending request past expiresAt, and writes it on the row', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    table(member('ana', { roles: ['approver'] }), [
      request('req_1760000000002_0123456789ab'),
      request('req_1760000000001_0123456789ab', { expiresAt: past }),
      request('req_1760000000000_0123456789ab', { expiresAt: past, status: 'APPROVED' }),
    ])

    const { body } = await list('ana')

    expect(body.requests.map((r: any) => r.status)).toEqual(['PENDING', 'EXPIRED', 'APPROVED'])
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      key: { id: 'mrc_a', sk: 'REQ#req_1760000000001_0123456789ab' },
      updateExpression: 'SET #status = :expired, #updatedAt = :now',
      conditionExpression: '#status = :pending AND #expiresAt <= :now',
    }))
  })

  it('still answers EXPIRED when that write fails', async () => {
    table(member('maker'), [request('req_1760000000001_0123456789ab', { expiresAt: new Date(Date.now() - 1000).toISOString() })])
    mockUpdate.mockResolvedValue({ success: false, res: null, error: { name: 'InternalServerError' } })

    const { statusCode, body } = await list('maker')

    expect(statusCode).toBe(200)
    expect(body.requests[0].status).toBe('EXPIRED')
  })

  it.each([
    ['a caller who is on no team', [], 100042],
    ['a member who was removed', member('maker', { status: 'removed' }), 100042],
  ])('refuses %s without reading any request', async (_, caller, code) => {
    table(caller, [request('req_1760000000001_0123456789ab')])
    const { body } = await list('maker')
    expect(body.error_code).toBe(code)
    expect(mockQuery).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('begins_with'), expect.anything(), expect.anything(), expect.anything())
  })

  it('answers 500 when the requests cannot be read, not an empty list', async () => {
    table(member('maker'), null)
    const { statusCode, body } = await list('maker')
    expect(statusCode).toBe(500)
    expect(body).toEqual({ error_code: 100002, message: 'internal error while processing the request' })
  })
})
