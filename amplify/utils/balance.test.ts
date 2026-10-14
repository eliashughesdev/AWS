import { applyBalanceChange } from './balance'
import { putItem, updateItem } from './db'

jest.mock('./db', () => ({
  putItem: jest.fn(async () => ({ success: true })),
  updateItem: jest.fn(async () => ({ success: true, res: { Attributes: { balance: { N: '9.5' } } } })),
}))

const change = (direction: 'CREDIT' | 'DEBIT', type?: string) => applyBalanceChange({
  account: { vAccountId: 'va-1' }, direction, amount: 0.5, currency: 'TRON', txId: 'tx-1', from: 'TFrom', type,
})

const update = () => (updateItem as jest.Mock).mock.calls[0][0]

describe('applyBalanceChange', () => {
  // native-sweep-plan step 2 (B4 part 1): the balance was read, then written back as an absolute
  // value, so a deposit credited in between was lost. The update now adds to what is stored
  it('adds to the stored balance instead of writing one it read', async () => {
    expect(await change('CREDIT')).toBe(true)
    expect(update().updateExpression).toBe('SET #balance = #balance + :delta, #availableBalance = #availableBalance + :delta, #lastUpdated = :now')
    expect(update().attributeValues[':delta']).toBe(0.5)
  })

  it('takes a debit off both balances', async () => {
    await change('DEBIT')
    expect(update().attributeValues[':delta']).toBe(-0.5)
  })

  it('claims the transaction on the account before moving its balance', async () => {
    await change('DEBIT', 'FEE')
    expect(putItem).toHaveBeenCalledWith('v1TransactionLogsTable', expect.objectContaining({
      id: 'va-1', sk: 'TX#tx-1', txId: 'tx-1', type: 'FEE', amount: 0.5, currency: 'TRON', from: 'TFrom',
    }), 'attribute_not_exists(sk)')
  })

  it('names a transaction by its direction when no type is given', async () => {
    await change('CREDIT')
    expect((putItem as jest.Mock).mock.calls[0][1].type).toBe('DEPOSIT')
  })

  it('applies a transaction once', async () => {
    ;(putItem as jest.Mock).mockResolvedValueOnce({ success: false, error: { name: 'ConditionalCheckFailedException' } })
    expect(await change('CREDIT')).toBe(true)
    expect(updateItem).not.toHaveBeenCalled()
  })

  it('fails when the claim cannot be written', async () => {
    ;(putItem as jest.Mock).mockResolvedValueOnce({ success: false, error: new Error('throttled') })
    expect(await change('CREDIT')).toBe(false)
    expect(updateItem).not.toHaveBeenCalled()
  })

  it('fails when the balance cannot be updated, a missing record included', async () => {
    ;(updateItem as jest.Mock).mockResolvedValueOnce({ success: false, error: { name: 'ValidationException' } })
    expect(await change('CREDIT')).toBe(false)
  })
})
