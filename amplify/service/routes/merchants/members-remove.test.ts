import RemoveMerchantMemberHandler from './members-remove'
import { deleteItem, putItem, queryRecord, updateItem } from '../../../utils/db'
import { disableUser } from '../../../utils/cognito'

jest.mock('../../../utils/db', () => ({ deleteItem: jest.fn(), putItem: jest.fn(), queryRecord: jest.fn(), updateItem: jest.fn() }))
jest.mock('../../../utils/cognito', () => ({ disableUser: jest.fn() }))
const mockQuery = jest.mocked(queryRecord)
const mockUpdate = jest.mocked(updateItem)
const mockPut = jest.mocked(putItem)
const mockDelete = jest.mocked(deleteItem)

const member = { id: 'mrc_a', sk: 'MEMBER#ana', userId: 'ana', roles: ['approver'], status: 'active' }
const request = (requestId: string, change: Record<string, any> = {}) =>
  ({ id: 'mrc_a', sk: `REQ#${requestId}`, requestId, initiatorId: 'maker', approvers: ['ana', 'ben'], status: 'PENDING', ...change })

// The member's row by key, and `requests` for the one query that reads a range of REQ# rows
const table = (requests: Record<string, any>[] | null) =>
  mockQuery.mockImplementation(async (_table, _expression, values) => ':from' in values
    ? { success: requests !== null, res: requests }
    : { success: true, res: values[':sk'] === member.sk ? [member] : [] })

const remove = async () => {
  const res = await new RemoveMerchantMemberHandler().execute({ body: { merchantId: 'mrc_a', userId: 'ana' }, requestContext: { authorizer: { userId: 'staff-1' } } }, {} as any)
  return { statusCode: res.statusCode, body: JSON.parse(res.body) }
}

describe('POST /merchants/members/remove', () => {
  beforeEach(() => {
    mockDelete.mockResolvedValue({ success: true, res: {} as any })
    mockPut.mockResolvedValue({ success: true, res: {} as any, error: null })
    mockUpdate.mockResolvedValue({ success: true, res: {} as any, error: null })
    jest.mocked(disableUser).mockResolvedValue({} as any)
  })

  // A request waiting on their vote could never complete, and one they made or approved
  // would still go on to move money
  it('cancels the pending requests the member made or may vote on', async () => {
    table([request('req_theirs', { initiatorId: 'ana', approvers: ['ben'] }), request('req_waiting'), request('req_other', { approvers: ['ben'] })])

    const { statusCode, body } = await remove()

    expect(statusCode).toBe(200)
    expect(body).toEqual({ success: true, merchantId: 'mrc_a', userId: 'ana', status: 'removed', cancelledRequests: ['req_theirs', 'req_waiting'] })
    expect(mockUpdate.mock.calls.map(([update]) => update.key.sk)).toEqual(['REQ#req_theirs', 'REQ#req_waiting'])
    expect(mockPut).toHaveBeenCalledWith('v1MerchantTable', expect.objectContaining({ sk: 'MEMBER#ana', status: 'removed', removedBy: 'staff-1' }))
  })

  it('answers an empty list when the member is part of no pending request', async () => {
    table([])
    expect((await remove()).body.cancelledRequests).toEqual([])
  })

  // Access ends first; the member is marked removed last, so a removal that failed in between
  // still finds an active member when it is sent again and cancels what is left
  it('ends the membership before cancelling, and marks the member removed after', async () => {
    table([request('req_waiting')])

    await remove()

    const [unlinked] = mockDelete.mock.invocationCallOrder
    const [cancelled] = mockUpdate.mock.invocationCallOrder
    const [marked] = mockPut.mock.invocationCallOrder
    expect(mockDelete).toHaveBeenCalledWith('v1MerchantTable', { id: 'USER#ana', sk: 'MEMBERSHIP' })
    expect(unlinked).toBeLessThan(cancelled)
    expect(cancelled).toBeLessThan(marked)
  })

  it.each([
    ['the requests cannot be read', () => table(null)],
    ['a request cannot be cancelled', () => {
      table([request('req_waiting')])
      mockUpdate.mockResolvedValue({ success: false, res: null, error: { name: 'InternalServerError' } })
    }],
  ])('answers 100003 and leaves the member active when %s', async (_, arrange) => {
    arrange()

    const { statusCode, body } = await remove()

    expect(statusCode).toBe(400)
    expect(body.error_code).toBe(100003)
    expect(mockPut).not.toHaveBeenCalled()
    expect(disableUser).not.toHaveBeenCalled()
  })

  it('answers 100049 for a member already removed, cancelling nothing', async () => {
    mockQuery.mockResolvedValue({ success: true, res: [{ ...member, status: 'removed' }] })

    expect((await remove()).body.error_code).toBe(100049)
    expect(mockDelete).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
