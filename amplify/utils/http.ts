interface HttpResponse {
	statusCode: number
	headers: object | null
	bodyObject: object
}

export const response = (data: HttpResponse) => {
	return {
		statusCode: data.statusCode || 200,
		headers: data.headers || {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Headers': '*',
		},
		body: JSON.stringify(data.bodyObject),
	}
}