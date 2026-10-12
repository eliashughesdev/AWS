import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { updateItem } from './db'

describe('updateItem', () => {
  let send: jest.SpyInstance
  const sent = () => send.mock.calls[0][0].input

  beforeEach(() => {
    send = jest.spyOn(DynamoDBClient.prototype, 'send').mockResolvedValue({} as never)
  })
  afterEach(() => jest.restoreAllMocks())

  it('sends the values its expression names', async () => {
    await updateItem({
      tableName: 't',
      key: { id: '1' },
      updateExpression: 'SET #name = :name',
      attributeNames: { '#name': 'name' },
      attributeValues: { ':name': 'Savings' },
    })
    expect(sent().ExpressionAttributeValues).toEqual({ ':name': { S: 'Savings' } })
  })

  // DynamoDB refuses an empty ExpressionAttributeValues, so a bare REMOVE must send none
  it('sends no values for an expression that has none', async () => {
    const res = await updateItem({
      tableName: 't',
      key: { id: '1' },
      updateExpression: 'REMOVE #name',
      attributeNames: { '#name': 'name' },
      attributeValues: {},
    })
    expect(res.success).toBe(true)
    expect(sent().ExpressionAttributeValues).toBeUndefined()
  })
})
