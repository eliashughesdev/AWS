import accountsKyc from './routes/accounts/kyc'
import accountsDetails from './routes/accounts/details'
import accountsAccount from './routes/accounts/account'
import webhookHandler from './routes/webhook/cb'
import { checkForRequiredParameters } from '../utils/params'
import { processError } from '../errors/http'

type RoutesMap = Map<string, {
	handler: any
	requiredParams: string[]
	method: string
}>

export const routes: RoutesMap = new Map([
	['/v1/webhook', { handler: webhookHandler, requiredParams: [], method: 'POST' }],
	['/v1/accounts/kyc', { handler: accountsKyc, requiredParams: [], method: 'POST' }],
	['/v1/accounts/details', { handler: accountsDetails, requiredParams: ['account_id'], method: 'POST' }],
	['/v1/accounts/account', { handler: accountsAccount, requiredParams: ['account_name'], method: 'POST' }],
])

export const router = async (event: { body: any, path: string }, context: any) => {
	// console.log(JSON.stringify(event))
	const route = routes.get(event.path)
	if (!route) {
		return {
			statusCode: 404,
			body: JSON.stringify({ message: 'Not Found' })
		}
	}
	try {
		if (event.body && typeof event.body === 'string') event.body = JSON.parse(event.body)
		const _check = checkForRequiredParameters(event.body, route.requiredParams)
		if (!_check.valid) return processError(100029, _check.message)
		console.log('type: ', typeof route.handler)
		const handlerInstance = new route.handler
		return await handlerInstance.execute(event, context)
	} catch (e) {
		console.log('catch block', e)
		return {
			statusCode: 500,
			body: JSON.stringify({ message: 'Internal Server Error' }),
		}
	}
}
