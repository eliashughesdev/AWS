const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb')
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb')

const db = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-2' })

const getRecord = async (tableName, id) => {
	const input = new GetItemCommand({
		TableName: tableName,
		Key: marshall({ id }),
	})
	try {
		const res = await db.send(input)
		return {
			success: true,
			res: res.Item ? unmarshall(res.Item) : null,
		}
	} catch (e) {
		console.log(e)
		return { success: false, res: null }
	}
}

module.exports = { getRecord }