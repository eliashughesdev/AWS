import type { APIGatewayProxyHandler } from 'aws-lambda'
import { router } from '../../service/router'
import { loadConfig } from '../../utils/config'

export const handler: APIGatewayProxyHandler = async (event, context) => {
  await loadConfig()
  return await router(event, context)
  // return {
  //  statusCode: 200,
  //  headers: {
  //    'Access-Control-Allow-Origin': '*',
  //    'Access-Control-Allow-Headers': '*',
  //  },
  //  body: JSON.stringify('handler response'),
  // }
}
