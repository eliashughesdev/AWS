import AccountsRenameHandler from './rename'
import { updateItem } from '../../../utils/db'

jest.mock('../../../utils/db', () => ({ updateItem: jest.fn() }))
const mockUpdate = jest.mocked(updateItem)

const accountNumber = 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4'
const rename = (name: string, authorizer: Record<string, string> = { userId: 'user-1', authType: 'jwt' }) =>
  new AccountsRenameHandler().execute({ body: { accountNumber, name }, requestContext: { authorizer } }, {} as any)

describe('POST /accounts/rename', () => {
  beforeEach(() => {
    mockUpdate.mockResolvedValue({ success: true, res: {} as any, error: null })
  })

  it('sets the trimmed name on the caller\'s own account', async () => {
    const res = await rename('  Savings ')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ success: true })
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      tableName: 'v2CustomerTable',
      key: { id: 'user-1', sk: `ACCOUNT#${accountNumber}` },
      updateExpression: 'SET #name = :name',
      conditionExpression: 'attribute_exists(id)',
      attributeValues: { ':name': 'Savings' },
    }))
  })

  it.each([
    ['an empty', ''],
    ['a blank', '   '],
  ])('removes the name for %s one', async (_, name) => {
    const res = await rename(name)
    expect(res.statusCode).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      updateExpression: 'REMOVE #name',
      conditionExpression: 'attribute_exists(id)',
      attributeValues: {},
    }))
  })

  // Someone else's account and one that does not exist are the same miss
  it('answers 100001 when the caller has no such account', async () => {
    mockUpdate.mockResolvedValue({ success: false, res: null, error: { name: 'ConditionalCheckFailedException' } })
    const res = await rename('Savings')
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error_code).toBe(100001)
  })

  it('answers 100003 when the write fails for another reason', async () => {
    mockUpdate.mockResolvedValue({ success: false, res: null, error: { name: 'InternalServerError' } })
    expect(JSON.parse((await rename('Savings')).body).error_code).toBe(100003)
  })

  it('writes nothing for a caller with no user id', async () => {
    const res = await rename('Savings', {})
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error_code).toBe(100053)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
