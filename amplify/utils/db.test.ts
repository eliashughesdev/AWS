import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { queryRecord, scanItems, updateItem } from './db'

describe('scanItems', () => {
  let send: jest.SpyInstance
  afterEach(() => jest.restoreAllMocks())

  // A scan stops at 1 MB: stopping at the first response would silently drop the rest
  it('reads every page and answers the items of all of them', async () => {
    send = jest.spyOn(DynamoDBClient.prototype, 'send')
      .mockResolvedValueOnce({ Items: [{ id: { S: 'a' } }], LastEvaluatedKey: { id: { S: 'a' } } } as never)
      .mockResolvedValueOnce({ Items: [{ id: { S: 'b' } }] } as never)

    const res = await scanItems('t', 'sk = :sk', { ':sk': 'PROFILE' })

    expect(res).toEqual({ success: true, res: [{ id: 'a' }, { id: 'b' }] })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][0].input).toMatchObject({ TableName: 't', FilterExpression: 'sk = :sk', ExpressionAttributeValues: { ':sk': { S: 'PROFILE' } } })
    expect(send.mock.calls[0][0].input.ExclusiveStartKey).toBeUndefined()
    expect(send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ id: { S: 'a' } })
  })

  it('answers a failure, not the pages it had, when a later page cannot be read', async () => {
    send = jest.spyOn(DynamoDBClient.prototype, 'send')
      .mockResolvedValueOnce({ Items: [{ id: { S: 'a' } }], LastEvaluatedKey: { id: { S: 'a' } } } as never)
      .mockRejectedValueOnce(new Error('throttled') as never)

    expect(await scanItems('t', 'sk = :sk', { ':sk': 'PROFILE' })).toEqual({ success: false, res: null })
  })
})

describe('queryRecord', () => {
  let send: jest.SpyInstance
  const sent = () => send.mock.calls[0][0].input

  beforeEach(() => {
    send = jest.spyOn(DynamoDBClient.prototype, 'send').mockResolvedValue({ Items: [{ sk: { S: 'b' } }, { sk: { S: 'a' } }] } as never)
  })
  afterEach(() => jest.restoreAllMocks())

  it('reads in sort-key order with no limit unless told otherwise', async () => {
    await queryRecord('t', 'id = :id', { ':id': '1' })
    expect(sent()).toMatchObject({ TableName: 't', KeyConditionExpression: 'id = :id', ConsistentRead: false, ScanIndexForward: true })
    expect(sent().Limit).toBeUndefined()
  })

  // Forwards, the first megabyte of a long partition is its oldest items
  it('reads the last items first, and no more than the limit, when asked', async () => {
    const res = await queryRecord('t', 'id = :id', { ':id': '1' }, false, { descending: true, limit: 2 })
    expect(sent()).toMatchObject({ ScanIndexForward: false, Limit: 2 })
    expect(res).toEqual({ success: true, res: [{ sk: 'b' }, { sk: 'a' }] })
  })
})

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
