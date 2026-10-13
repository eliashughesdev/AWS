import {
  AttributeValue,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  ReturnValue,
  UpdateItemCommand,
  TransactWriteItemsCommand,
  DeleteItemCommand
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

const db = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-2' })

export const getRecord = async (tableName: string | undefined, id: string) => {
  try {
    const input = new GetItemCommand({
      TableName: tableName,
      Key: marshall({ id }),
    })
    const res = await db.send(input)
    console.log(JSON.stringify(res))
    return {
      success: true,
      res: res.Item ? unmarshall(res.Item as { [key: string]: AttributeValue }) : null,
    }
  } catch (e) {
    console.log(e)
    return { success: false, res: null }
  }
}

// Answers one page (1 MB at most) in sort-key order. `descending` with a `limit` reads the
// last items of a partition without the first ones filling that page
export const queryRecord = async (tableName: string | undefined, keyConditionExpression: string, expressionAttributeValues: Record<string, any>, consistentRead = false, order: { descending?: boolean, limit?: number } = {}) => {
  const input = new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: keyConditionExpression,
    ExpressionAttributeValues: marshall(expressionAttributeValues),
    ConsistentRead: consistentRead,
    ScanIndexForward: !order.descending,
    Limit: order.limit,
  })
  try {
    const res = await db.send(input)
    const items = res.Items ? res.Items.map(item => unmarshall(item as { [key: string]: AttributeValue })) : []
    return {
      success: true,
      res: items,
    }
  } catch (e) {
    console.log(e)
    return { success: false, res: null }
  }
}

/**
 * Every item of a table that passes a filter. A scan reads the whole table
 * whatever the filter keeps, so this is only for a small table and a rare caller.
 */
export const scanItems = async (tableName: string | undefined, filterExpression: string, expressionAttributeValues: Record<string, any>) => {
  const items: Record<string, any>[] = []
  let startKey: Record<string, AttributeValue> | undefined
  try {
    // One response holds at most 1 MB of the table
    do {
      const res = await db.send(new ScanCommand({
        TableName: tableName,
        FilterExpression: filterExpression,
        ExpressionAttributeValues: marshall(expressionAttributeValues),
        ExclusiveStartKey: startKey,
      }))
      for (const item of res.Items ?? []) items.push(unmarshall(item))
      startKey = res.LastEvaluatedKey
    } while (startKey)
    return { success: true, res: items }
  } catch (e) {
    console.log(e)
    return { success: false, res: null }
  }
}

interface IQueryItemFromIndexRequest {
  tableName: string | undefined
  indexName: string
  keyConditionExpression: string
  attributeNames: Record<string, string> | undefined
  attributeValues: Record<string, any>
}

interface ITransactWriteItemsRequest { // ADDED: Interface for transactional writes
  // Array of items to put atomically. All items must be for the same table in this common pattern.
  puts: {
    tableName: string;
    item: Record<string, any>;
    // e.g. 'attribute_not_exists(id)' — the whole transaction is cancelled if it fails
    conditionExpression?: string;
  }[]
}

/**
 * Query item from index
 * @param q
 * {
 *   tableName: 'table',
 *   indexName: 'indexName',
 *   keyConditionExpression: '#pk = :pkValue',
 *   attributeNames: {
 *     '#pk': 'card_id'
 *   },
 *   attributeValue: {
 *     ':pkValue': 'value'
 *   }
 * }
 */
export const queryItemFromIndex = async (q: IQueryItemFromIndexRequest) => {
  const command = new QueryCommand({
    TableName: q.tableName,
    IndexName: q.indexName,
    KeyConditionExpression: q.keyConditionExpression,
    ExpressionAttributeNames: q.attributeNames,
    ExpressionAttributeValues: marshall(q.attributeValues)
  })

  try {
    const response = await db.send(command)
    const items = []
    if (response.Items) {
      for (const item of response.Items) {
        items.push(unmarshall(item as { [key: string]: AttributeValue }))
      }
    }
    return { success: true, res: items }
  } catch (e) {
    console.log(e)
    return { success: false, res: null }
  }
}

export const putItem = async (tableName: string | undefined, item: Record<string, any>, conditionExpression?: string) => {
  const command = new PutItemCommand({
    TableName: tableName,
    Item: marshall(item, { removeUndefinedValues: true }),
    ConditionExpression: conditionExpression,
  })
  try {
    const response = await db.send(command)
    return { success: true, res: response, error: null }
  } catch (e: any) {
    return { success: false, res: null, error: e }
  }
}

export const deleteItem = async (tableName: string | undefined, key: Record<string, any>) => {
  const command = new DeleteItemCommand({
    TableName: tableName,
    Key: marshall(key)
  })
  try {
    const response = await db.send(command)
    return { success: true, res: response }
  } catch (e) {
    console.log(e)
    return { success: false, res: null }
  }
}

interface IUpdateItemRequest {
  tableName: string | undefined
  key: Record<string, any>
  updateExpression: string | undefined
  conditionExpression?: string
  attributeNames: Record<string, string> | undefined
  attributeValues: Record<string, any>
  returnValues?: ReturnValue
}
/**
 * Update record by id
 * @param r
 * {
 *   tableName: 'table-name',
 *   key: { card_id: '1234' },
 *   updateExpression: 'SET #attributeName = :newValue, #anotherAttribute = :anotherValue',
 *   attributeNames: {
 *     "#attributeName": "attributeToUpdate",
 *     "#anotherAttribute": "anotherAttributeToUpdate"
 *   },
 *   attributeValues: {
 *      ":newValue": "updatedStringValue",
 *      ":anotherValue": "123"
 *    }
 * }
 */
export const updateItem = async (r: IUpdateItemRequest) => {
  const values = marshall(r.attributeValues, { removeUndefinedValues: true })
  const command = new UpdateItemCommand({
    TableName: r.tableName,
    Key: marshall(r.key, { removeUndefinedValues: true }),
    UpdateExpression: r.updateExpression,
    ConditionExpression: r.conditionExpression,
    ExpressionAttributeNames: r.attributeNames,
    // DynamoDB refuses an empty map, which an expression with no values (a bare REMOVE) would send
    ExpressionAttributeValues: Object.keys(values).length ? values : undefined,
    ReturnValues: r.returnValues,
  })

  try {
    const response = await db.send(command)
    return { success: true, res: response, error: null }
  } catch (e: any) {
    console.log(e)
    return { success: false, res: null, error: e }
  }
}

export const transactWriteItems = async (r: ITransactWriteItemsRequest) => {
  const transactItems = r.puts.map(putOperation => ({
    Put: {
      TableName: putOperation.tableName,
      Item: marshall(putOperation.item, { removeUndefinedValues: true }),
      ConditionExpression: putOperation.conditionExpression,
    }
  }))

  const command = new TransactWriteItemsCommand({
    TransactItems: transactItems,
  })

  try {
    const response = await db.send(command)
    return { success: true, res: response, error: null }
  } catch (e: any) {
    console.error('TransactWriteItems failed:', e)
    // In case of a transaction failure, provide the error details
    return { success: false, res: null, error: e }
  }
}
