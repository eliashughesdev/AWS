import CancelRequestHandler from './cancel'
import { queryRecord, updateItem } from '../../../../utils/db'

jest.mock('../../../../utils/db', () => ({ queryRecord: jest.fn(), updateItem: jest.fn() }))
const mockQuery = jest.mocked(queryRecord)
const mockUpdate = jest.mocked(updateItem)

const HOUR = 60 * 60 * 1000
const requestId = 'req_1760000000000_0123456789ab'
const refused = { success: false, res: null, error: { name: 'ConditionalCheckFailedException' } }

const request = (change: Record<string, any> = {}) => ({
  id: 'mrc_a',
  sk: `REQ#${requestId}`,
  requestId,
  initiatorId: 'maker',
  approvers: ['ana', 'ben'],
  requiredCount: 2,
  votes: {},
  approvalCount: 0,
  status: 'PENDING',
  expiresAt: new Date(Date.now() + HOUR).toISOString(),
  ...change,
})

const member = (userId: string, change: Record<string, any> = {}) => [
  { id: `USER#${userId}`, sk: 'MEMBERSHIP', merchantId: 'mrc_a' },
  { id: 'mrc_a', sk: `MEMBER#${userId}`, userId, roles: ['initiator'], status: 'active', ...change },
]

// What queryRecord answers from, by key
let rows: Record<string, any>[]
const table = (...stored: Record<string, any>[]) => { rows = [{ id: 'mrc_a', sk: 'PROFILE', status: 'active' }, ...stored] }

const cancel = async (userId: string) => {
  const res = await new CancelRequestHandler().execute({ body: { requestId }, requestContext: { authorizer: { userId } } }, {} as any)
  return { statusCode: res.statusCode, body: JSON.parse(res.body) }
}

describe('POST /merchants/operations/cancel', () => {
  beforeEach(() => {
    mockQuery.mockImplementation(async (_table, _expression, values) =>
      ({ success: true, res: rows.filter(row => row.id === values[':id'] && row.sk === values[':sk']) }))
    mockUpdate.mockResolvedValue({ success: true, res: {} as any, error: null })
  })

  it('cancels the caller\'s own pending request, on the condition that it still is', async () => {
    table(...member('maker'), request({ approvalCount: 1, votes: { ana: { decision: 'approve', at: 'earlier' } } }))

    const { statusCode, body } = await cancel('maker')

    expect(statusCode).toBe(200)
    expect(body).toEqual({ success: true, requestId, status: 'CANCELLED' })
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      tableName: 'v1MerchantTable',
      key: { id: 'mrc_a', sk: `REQ#${requestId}` },
      updateExpression: 'SET #status = :cancelled, #updatedAt = :now',
      conditionExpression: '#status = :pending AND #initiatorId = :me AND #expiresAt > :now',
      attributeValues: expect.objectContaining({ ':cancelled': 'CANCELLED', ':pending': 'PENDING', ':me': 'maker' }),
    }))
  })

  describe('refuses, cancelling nothing', () => {
    const refusals: [string, Record<string, any>[], string, number, string][] = [
      ['a caller who is on no team', [request()], 'maker', 100042, 'you are not a member of any merchant'],
      ['a request that does not exist', member('maker'), 'maker', 100054, 'this request does not exist'],
      ['another merchant\'s request', [...member('maker'), { ...request(), id: 'mrc_b' }], 'maker', 100054, 'this request does not exist'],
      ['an approver of the request', [...member('ana'), request()], 'ana', 100060, 'only the member who made this request can cancel it'],
      ['another initiator of the same merchant', [...member('other'), request()], 'other', 100060, 'only the member who made this request can cancel it'],
      ['an approved request', [...member('maker'), request({ status: 'APPROVED' })], 'maker', 100055, 'this request is no longer pending: it is APPROVED'],
      ['a request cancelled before', [...member('maker'), request({ status: 'CANCELLED' })], 'maker', 100055, 'this request is no longer pending: it is CANCELLED'],
      ['a request already marked expired', [...member('maker'), request({ status: 'EXPIRED' })], 'maker', 100056, 'this request has expired'],
    ]

    it.each(refusals)('%s', async (_, stored, userId, code, message) => {
      table(...stored)
      const { statusCode, body } = await cancel(userId)
      expect(statusCode).toBe(400)
      expect(body).toEqual({ error_code: code, message })
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('a request past expiresAt, which it marks EXPIRED', async () => {
      table(...member('maker'), request({ expiresAt: new Date(Date.now() - 1000).toISOString() }))

      const { body } = await cancel('maker')

      expect(body).toEqual({ error_code: 100056, message: 'this request has expired' })
      expect(mockUpdate).toHaveBeenCalledTimes(1)
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        updateExpression: 'SET #status = :expired, #updatedAt = :now',
        conditionExpression: '#status = :pending AND #expiresAt <= :now',
      }))
    })
  })

  // The last approval and the cancel at the same moment: only one of the two writes goes through
  it('answers that the request is approved when the last approval got in first', async () => {
    table(...member('maker'), request())
    mockUpdate.mockImplementationOnce(async () => {
      table(...member('maker'), request({ status: 'APPROVED', approvalCount: 2 }))
      return refused
    })

    const { body } = await cancel('maker')

    expect(body).toEqual({ error_code: 100055, message: 'this request is no longer pending: it is APPROVED' })
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  it('answers 100003 without trying again when the write fails for another reason', async () => {
    table(...member('maker'), request())
    mockUpdate.mockResolvedValue({ success: false, res: null, error: { name: 'ProvisionedThroughputExceededException' } })

    expect((await cancel('maker')).body.error_code).toBe(100003)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })
})
