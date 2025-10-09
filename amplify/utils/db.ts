import {
	AttributeValue,
	DynamoDBClient,
	GetItemCommand,
	PutItemCommand,
	QueryCommand,
	UpdateItemCommand
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

const db = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-2' })

export const getRecord = async (tableName: string | undefined, id: string) => {
	const input = new GetItemCommand({
		TableName: tableName,
		Key: marshall({ id }),
	})
	try {
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

interface IQueryItemFromIndexRequest {
	tableName: string | undefined
	indexName: string
	keyConditionExpression: string
	attributeNames: Record<string, string> | undefined
	attributeValues: Record<string, AttributeValue>
}

/**
 * Query item from index
 * @param q
 * {
 *   tableName: 'table',
 *   indexName: 'indexName',
 *   keyConditionExpression: '#pk = :pkValue',
 *	 attributeNames: {
 *	   '#pk': 'card_id'
 *	 },
 *	 attributeValue: {
 *	   ':pkValue': 'value'
 *	 }
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

export const putItem = async (tableName: string | undefined, item: Record<string, AttributeValue>) => {
	const command = new PutItemCommand({
		TableName: tableName,
		Item: marshall(item)
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
	key: Record<string, AttributeValue>
	updateExpression: string | undefined
	attributeNames: Record<string, string> | undefined
	attributeValues: Record<string, AttributeValue>
}
/**
 * Update record by id
 * @param r
 * {
 *   tableName: 'table-name',
 *   key: { card_id: '1234' },
 *   updateExpression: 'SET #attributeName = :newValue, #anotherAttribute = :anotherValue',
 *   attributeNames: {
 * 		 "#attributeName": "attributeToUpdate",
 * 		 "#anotherAttribute": "anotherAttributeToUpdate"
 *   },
 *   attributeValues: {
 * 			":newValue": "updatedStringValue",
 * 			":anotherValue": "123"
 * 		}
 * }
 */
export const updateItem = async (r: IUpdateItemRequest) => {
	const command = new UpdateItemCommand({
		TableName: r.tableName,
		Key: marshall(r.key),
		UpdateExpression: r.updateExpression,
		ExpressionAttributeNames: r.attributeNames,
		ExpressionAttributeValues: marshall(r.attributeValues)
	})

	try {
		const response = await db.send(command)
		return { success: true, res: response }
	} catch (e) {
		console.log(e)
		return { success: false, res: null }
	}
}