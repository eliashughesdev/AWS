import { cancelRequestsOf, COUNTED_STATUSES, currentStatus, REQUEST_TTL_MS } from './treasuryRequest'
import { queryRecord, updateItem } from './db'

jest.mock('./db', () => ({ queryRecord: jest.fn(), updateItem: jest.fn() }))
const mockQuery = jest.mocked(queryRecord)
const mockUpdate = jest.mocked(updateItem)

const HOUR = 60 * 60 * 1000
const written = { success: true, res: {} as any, error: null }

const request = (requestId: string, change: Record<string, any> = {}) => ({
  id: 'mrc_a',
  sk: `REQ#${requestId}`,
  requestId,
  initiatorId: 'maker',
  approvers: ['ana', 'ben'],
  status: 'PENDING',
  expiresAt: new Date(Date.now() + HOUR).toISOString(),
  ...change,
})

beforeEach(() => mockUpdate.mockResolvedValue(written))

describe('the statuses that count toward the 24-hour threshold', () => {
  it.each(['REJECTED', 'CANCELLED', 'EXPIRED'])('leave out %s: it moved no money and never will', status => {
    expect(COUNTED_STATUSES).not.toContain(status)
  })

  it.each(['PENDING', 'APPROVED'])('keep %s', status => {
    expect(COUNTED_STATUSES).toContain(status)
  })

  // A row past expiresAt says PENDING until a route meets it. It is not counted only because
  // the threshold looks back 24 hours, and no request that recent can have expired
  it('are never read from an expired row: a request lives longer than the 24 hours counted', () => {
    expect(REQUEST_TTL_MS).toBeGreaterThan(24 * HOUR)
  })
})

describe('currentStatus', () => {
  const now = new Date().toISOString()

  it('answers PENDING for a request that has not expired, writing nothing', async () => {
    expect(await currentStatus(request('req_1'), now)).toBe('PENDING')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('answers EXPIRED from expiresAt on, and writes it only if the row is still pending', async () => {
    const row = request('req_1', { expiresAt: now })

    expect(await currentStatus(row, now)).toBe('EXPIRED')
    expect(mockUpdate).toHaveBeenCalledWith({
      tableName: 'v1MerchantTable',
      key: { id: 'mrc_a', sk: 'REQ#req_1' },
      updateExpression: 'SET #status = :expired, #updatedAt = :now',
      conditionExpression: '#status = :pending AND #expiresAt <= :now',
      attributeNames: { '#status': 'status', '#updatedAt': 'updatedAt', '#expiresAt': 'expiresAt' },
      attributeValues: { ':expired': 'EXPIRED', ':pending': 'PENDING', ':now': now },
    })
  })

  // Expiry is for a request nobody decided: an approved one keeps its status for the sender
  it.each(['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'])('answers %s as stored, whatever its expiresAt', async status => {
    const row = request('req_1', { status, expiresAt: new Date(Date.now() - HOUR).toISOString() })
    expect(await currentStatus(row, now)).toBe(status)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

describe('cancelRequestsOf', () => {
  const stored = (...rows: Record<string, any>[]) => mockQuery.mockResolvedValue({ success: true, res: rows })

  it('reads, consistently, the requests young enough to be pending', async () => {
    stored()
    const before = Date.now()

    expect(await cancelRequestsOf('mrc_a', 'ana')).toEqual([])

    const [table, expression, values, consistent] = mockQuery.mock.calls[0]
    expect([table, expression, consistent]).toEqual(['v1MerchantTable', 'id = :id AND sk BETWEEN :from AND :to', true])
    expect(values[':id']).toBe('mrc_a')
    const from = Number(values[':from'].slice('REQ#req_'.length))
    expect(from).toBeGreaterThanOrEqual(before - REQUEST_TTL_MS)
    expect(from).toBeLessThanOrEqual(Date.now() - REQUEST_TTL_MS)
    expect(values[':to']).toMatch(/^REQ#req_\d{13}~$/)
  })

  it('cancels the pending requests the person made or may vote on, and no other', async () => {
    stored(
      request('req_made', { initiatorId: 'ana', approvers: ['ben'] }),
      request('req_may_vote'),
      request('req_voted', { votes: { ana: { decision: 'approve', at: 'earlier' } }, approvalCount: 1 }),
      request('req_not_theirs', { approvers: ['ben', 'cai'] }),
      request('req_approved', { status: 'APPROVED' }),
      request('req_rejected', { status: 'REJECTED' })
    )

    expect(await cancelRequestsOf('mrc_a', 'ana')).toEqual(['req_made', 'req_may_vote', 'req_voted'])

    expect(mockUpdate.mock.calls.map(([update]) => update.key.sk)).toEqual(['REQ#req_made', 'REQ#req_may_vote', 'REQ#req_voted'])
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      updateExpression: 'SET #status = :cancelled, #cancelReason = :reason, #updatedAt = :now',
      conditionExpression: '#status = :pending',
      attributeValues: expect.objectContaining({ ':cancelled': 'CANCELLED', ':reason': 'MEMBER_REMOVED', ':pending': 'PENDING' }),
    }))
  })

  it('leaves out a request that was decided while this ran', async () => {
    stored(request('req_1'), request('req_2'))
    mockUpdate.mockResolvedValueOnce({ success: false, res: null, error: { name: 'ConditionalCheckFailedException' } })

    expect(await cancelRequestsOf('mrc_a', 'ana')).toEqual(['req_2'])
  })

  it('answers null when the requests cannot be read', async () => {
    mockQuery.mockResolvedValue({ success: false, res: null })
    expect(await cancelRequestsOf('mrc_a', 'ana')).toBeNull()
  })

  it('answers null when a request could not be cancelled', async () => {
    stored(request('req_1'), request('req_2'))
    mockUpdate.mockResolvedValueOnce({ success: false, res: null, error: { name: 'InternalServerError' } })

    expect(await cancelRequestsOf('mrc_a', 'ana')).toBeNull()
  })
})
