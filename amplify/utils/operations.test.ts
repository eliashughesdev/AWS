import { newOperation, settleOperation } from './operations'
import { updateItem } from './db'

jest.mock('./db', () => ({ updateItem: jest.fn() }))

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => jest.restoreAllMocks())

// docs/public-api-plan.md step 1.5, D6.4
describe('newOperation', () => {
  it('keys the record on its user and starts it pending', () => {
    expect(newOperation({ userId: 'user-1', opId: 'wdr_1', kind: 'withdrawal', accountNumber: 'PCF1', currency: 'TRON', amount: 2 }))
      .toMatchObject({ id: 'user-1', sk: 'OP#wdr_1', opId: 'wdr_1', kind: 'withdrawal', status: 'pending', amount: 2, createdAt: expect.any(String) })
  })
})

describe('settleOperation', () => {
  const call = () => jest.mocked(updateItem).mock.calls[0][0]

  it('sets what it is given, only on a record that exists and is still pending or waiting', async () => {
    jest.mocked(updateItem).mockResolvedValue({ success: true, res: {}, error: null } as any)
    await settleOperation('user-1', 'wdr_1', { status: 'completed', txId: '0xabc' })
    expect(call().key).toEqual({ id: 'user-1', sk: 'OP#wdr_1' })
    expect(call().conditionExpression).toBe('attribute_exists(id) AND (#status = :pending OR #status = :action)')
    const set = Object.fromEntries(Object.entries(call().attributeNames!).filter(([name]) => name.startsWith('#f'))
      .map(([name, field]) => [field, call().attributeValues[name.replace('#', ':')]]))
    expect(set).toEqual({ status: 'completed', txId: '0xabc', updatedAt: expect.any(String) })
  })

  it('leaves a record already settled, or missing, without a word', async () => {
    jest.mocked(updateItem).mockResolvedValue({ success: false, res: null, error: { name: 'ConditionalCheckFailedException' } } as any)
    await settleOperation('user-1', 'wdr_1', { status: 'failed' })
    expect(console.error).not.toHaveBeenCalled()
  })

  it('never throws: the operation has happened whatever its record says', async () => {
    jest.mocked(updateItem).mockRejectedValue(new Error('network'))
    await expect(settleOperation('user-1', 'wdr_1', { status: 'failed' })).resolves.toBeUndefined()
    jest.mocked(updateItem).mockResolvedValue({ success: false, res: null, error: { name: 'InternalServerError' } } as any)
    await expect(settleOperation('user-1', 'wdr_1', { status: 'failed' })).resolves.toBeUndefined()
    expect(console.error).toHaveBeenCalledTimes(2)
  })
})
