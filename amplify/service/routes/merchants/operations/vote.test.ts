import VoteOnRequestHandler from './vote'
import { queryRecord, updateItem } from '../../../../utils/db'

jest.mock('../../../../utils/db', () => ({ queryRecord: jest.fn(), updateItem: jest.fn() }))
const mockQuery = jest.mocked(queryRecord)
const mockUpdate = jest.mocked(updateItem)

const HOUR = 60 * 60 * 1000
const requestId = 'req_1760000000000_0123456789ab'
const written = { success: true, res: {} as any, error: null }
const refused = { success: false, res: null, error: { name: 'ConditionalCheckFailedException' } }

// As /merchants/operations/treasury-send writes it: ana and ben must both approve
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
  { id: 'mrc_a', sk: `MEMBER#${userId}`, userId, roles: ['approver'], status: 'active', ...change },
]

// What queryRecord answers from, by key
let rows: Record<string, any>[]
const table = (...stored: Record<string, any>[]) => { rows = [{ id: 'mrc_a', sk: 'PROFILE', status: 'active' }, ...stored] }

const vote = async (userId: string, decision = 'approve', body: Record<string, any> = {}) => {
  const res = await new VoteOnRequestHandler().execute({ body: { requestId, decision, ...body } as any, requestContext: { authorizer: { userId } } }, {} as any)
  return { statusCode: res.statusCode, body: JSON.parse(res.body) }
}

const voteWrite = (userId: string, values: Record<string, any>) => expect.objectContaining({
  tableName: 'v1MerchantTable',
  key: { id: 'mrc_a', sk: `REQ#${requestId}` },
  updateExpression: 'SET #votes.#me = :vote, #approvalCount = :count, #status = :status, #updatedAt = :now',
  conditionExpression: '#status = :pending AND contains(#approvers, :me) AND attribute_not_exists(#votes.#me) AND #approvalCount = :seen AND #expiresAt > :now',
  attributeNames: expect.objectContaining({ '#me': userId, '#votes': 'votes', '#approvers': 'approvers' }),
  attributeValues: expect.objectContaining({ ':me': userId, ':pending': 'PENDING', ...values }),
})

describe('POST /merchants/operations/vote', () => {
  beforeEach(() => {
    mockQuery.mockImplementation(async (_table, _expression, values) =>
      ({ success: true, res: rows.filter(row => row.id === values[':id'] && row.sk === values[':sk']) }))
    mockUpdate.mockResolvedValue(written)
  })

  it('records an approval that is not the last one and leaves the request pending', async () => {
    table(...member('ana'), request())

    const { statusCode, body } = await vote('ana')

    expect(statusCode).toBe(200)
    expect(body).toEqual({ success: true, requestId, status: 'PENDING', approvalCount: 1, requiredCount: 2 })
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith(voteWrite('ana', { ':count': 1, ':seen': 0, ':status': 'PENDING' }))
    expect(mockUpdate.mock.calls[0][0].attributeValues[':vote']).toMatchObject({ decision: 'approve' })
  })

  it('approves the request with the approval that reaches requiredCount', async () => {
    table(...member('ben'), request({ approvalCount: 1, votes: { ana: { decision: 'approve', at: 'earlier' } } }))

    const { body } = await vote('ben')

    expect(body).toMatchObject({ status: 'APPROVED', approvalCount: 2 })
    expect(mockUpdate).toHaveBeenCalledWith(voteWrite('ben', { ':count': 2, ':seen': 1, ':status': 'APPROVED' }))
  })

  it('approves at once a request that needs one approval', async () => {
    table(...member('ana'), request({ requiredCount: 1 }))
    expect((await vote('ana')).body).toMatchObject({ status: 'APPROVED', approvalCount: 1, requiredCount: 1 })
  })

  it('ends the request with one rejection, whatever was approved before', async () => {
    table(...member('ben'), request({ approvalCount: 1, votes: { ana: { decision: 'approve', at: 'earlier' } } }))

    const { body } = await vote('ben', 'reject')

    expect(body).toMatchObject({ status: 'REJECTED', approvalCount: 1 })
    expect(mockUpdate).toHaveBeenCalledWith(voteWrite('ben', { ':count': 1, ':seen': 1, ':status': 'REJECTED' }))
    expect(mockUpdate.mock.calls[0][0].attributeValues[':vote']).toMatchObject({ decision: 'reject' })
  })

  // The merchant is the caller's own: the key is never built from the body
  it('ignores a merchant named in the body', async () => {
    table(...member('ana'), request(), { ...request(), id: 'mrc_b' })
    await vote('ana', 'approve', { merchantId: 'mrc_b' })
    expect(mockUpdate.mock.calls[0][0].key).toEqual({ id: 'mrc_a', sk: `REQ#${requestId}` })
  })

  describe('refuses, writing no vote', () => {
    const refusals: [string, Record<string, any>[], string, number, string][] = [
      ['a caller who is on no team', [request()], 'ana', 100042, 'you are not a member of any merchant'],
      ['a member who was removed', [...member('ana', { status: 'removed' }), request()], 'ana', 100042, 'you are not a member of any merchant'],
      ['a request that does not exist', member('ana'), 'ana', 100054, 'this request does not exist'],
      // Another merchant's request is not found either: the key holds the caller's merchant
      ['another merchant\'s request', [...member('ana'), { ...request(), id: 'mrc_b' }], 'ana', 100054, 'this request does not exist'],
      ['the initiator', [...member('maker', { roles: ['initiator', 'approver'] }), request()], 'maker', 100058, 'you cannot vote on a request you made'],
      // The list was fixed when the request was made: an approver invited since is not in it
      ['an approver who is not in the request\'s list', [...member('cai'), request()], 'cai', 100057, 'you are not an approver of this request'],
      ['a second vote', [...member('ana'), request({ approvalCount: 1, votes: { ana: { decision: 'approve', at: 'earlier' } } })], 'ana', 100059, 'you have already voted on this request'],
      ['an approved request', [...member('ben'), request({ requiredCount: 1, approvalCount: 1, status: 'APPROVED' })], 'ben', 100055, 'this request is no longer pending: it is APPROVED'],
      ['a rejected request', [...member('ben'), request({ status: 'REJECTED' })], 'ben', 100055, 'this request is no longer pending: it is REJECTED'],
      ['a cancelled request', [...member('ben'), request({ status: 'CANCELLED' })], 'ben', 100055, 'this request is no longer pending: it is CANCELLED'],
      ['a request already marked expired', [...member('ben'), request({ status: 'EXPIRED', expiresAt: new Date(Date.now() - HOUR).toISOString() })], 'ben', 100056, 'this request has expired'],
    ]

    it.each(refusals)('%s', async (_, stored, userId, code, message) => {
      table(...stored)
      const { statusCode, body } = await vote(userId)
      expect(statusCode).toBe(400)
      expect(body).toEqual({ error_code: code, message })
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('a merchant that is not active', async () => {
      rows = [{ id: 'mrc_a', sk: 'PROFILE', status: 'suspended' }, ...member('ana'), request()]
      expect((await vote('ana')).body.error_code).toBe(100040)
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('a request past expiresAt, which it marks EXPIRED', async () => {
      table(...member('ana'), request({ expiresAt: new Date(Date.now() - 1000).toISOString() }))

      const { body } = await vote('ana')

      expect(body).toEqual({ error_code: 100056, message: 'this request has expired' })
      expect(mockUpdate).toHaveBeenCalledTimes(1)
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        key: { id: 'mrc_a', sk: `REQ#${requestId}` },
        updateExpression: 'SET #status = :expired, #updatedAt = :now',
        conditionExpression: '#status = :pending AND #expiresAt <= :now',
      }))
    })
  })

  // Two approvers at the same moment both read approvalCount 0. Without the count in the
  // condition both would write 1 and the request would stay PENDING with every approval in
  describe('when another write gets in between the read and the vote', () => {
    it('decides again on the new count, so the second of two approvals is the one that approves', async () => {
      table(...member('ben'), request())
      mockUpdate.mockImplementationOnce(async () => {
        table(...member('ben'), request({ approvalCount: 1, votes: { ana: { decision: 'approve', at: 'just now' } } }))
        return refused
      })

      const { body } = await vote('ben')

      expect(body).toMatchObject({ status: 'APPROVED', approvalCount: 2 })
      expect(mockUpdate).toHaveBeenCalledTimes(2)
      expect(mockUpdate).toHaveBeenNthCalledWith(1, voteWrite('ben', { ':count': 1, ':seen': 0, ':status': 'PENDING' }))
      expect(mockUpdate).toHaveBeenNthCalledWith(2, voteWrite('ben', { ':count': 2, ':seen': 1, ':status': 'APPROVED' }))
    })

    it.each(['REJECTED', 'CANCELLED', 'APPROVED'])('answers that the request is %s when that is what got in', async status => {
      table(...member('ben'), request())
      mockUpdate.mockImplementationOnce(async () => {
        table(...member('ben'), request({ status }))
        return refused
      })

      const { body } = await vote('ben')

      expect(body).toEqual({ error_code: 100055, message: `this request is no longer pending: it is ${status}` })
      expect(mockUpdate).toHaveBeenCalledTimes(1)
    })

    it('reads the request consistently, or the second read could miss the write that beat it', async () => {
      table(...member('ana'), request())
      await vote('ana')
      expect(mockQuery).toHaveBeenCalledWith('v1MerchantTable', 'id = :id AND sk = :sk', { ':id': 'mrc_a', ':sk': `REQ#${requestId}` }, true)
    })

    it('gives up after three refused writes', async () => {
      table(...member('ana'), request())
      mockUpdate.mockResolvedValue(refused)

      const { body } = await vote('ana')

      expect(body.error_code).toBe(100003)
      expect(mockUpdate).toHaveBeenCalledTimes(3)
    })
  })

  it('answers 100003 without trying again when the write fails for another reason', async () => {
    table(...member('ana'), request())
    mockUpdate.mockResolvedValue({ success: false, res: null, error: { name: 'ProvisionedThroughputExceededException' } })

    expect((await vote('ana')).body.error_code).toBe(100003)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  it('answers 100003 when the table cannot be read', async () => {
    mockQuery.mockResolvedValue({ success: false, res: null })
    expect((await vote('ana')).body.error_code).toBe(100003)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
