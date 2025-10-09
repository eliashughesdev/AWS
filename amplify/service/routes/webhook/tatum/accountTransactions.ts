import { Context } from 'aws-lambda'

const statuses: any = {
	authorized: (body: any) => console.log('authorized. status logic'),
	canceled: (body: any) => console.log('canceled. status logic'),
	declined: (body: any) => console.log('declined. status logic'),
	completed: (body: any) => console.log('completed. status logic'),
}

export const accountTransactions = async (event: any, context: Context) => {
	return statuses[event.body.data.status](event.body)
}