export const checkForRequiredParameters = (body: any, requiredParams: string[]) => {
	for (const param of requiredParams) {
		if (!body.hasOwnProperty(param)) return { valid: false, message: requiredParams.join(',') }
		if (body.hasOwnProperty(param) && !body[param]) return { valid: false, message: requiredParams.join(',') }
	}
	return { valid: true }
}