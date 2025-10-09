import type { APIGatewayProxyHandler } from 'aws-lambda'
import { router } from '../../service/router'

export const handler: APIGatewayProxyHandler = async (event, context) => {
	console.log('event: ', event)
	return await router(event, context)
	// return {
	// 	statusCode: 200,
	// 	headers: {
	// 		'Access-Control-Allow-Origin': '*',
	// 		'Access-Control-Allow-Headers': '*',
	// 	},
	// 	body: JSON.stringify('handler response'),
	// }
}
