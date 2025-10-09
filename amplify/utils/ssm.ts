import { SSMClient, GetParameterCommand, GetParametersCommand, GetParametersByPathCommand } from '@aws-sdk/client-ssm'

const ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'us-east-2' })

export interface SsmParameter {
	name: string
	value: string
	type: string
	version: number
}

export async function getSsmParameter(name: string): Promise<string | undefined> {
	try {
		const command = new GetParameterCommand({
			Name: name,
			WithDecryption: true // This decrypts SecureString parameters
		})

		const response = await ssmClient.send(command)
		return response.Parameter?.Value
	} catch (error) {
		console.error(`Error fetching SSM parameter ${name}:`, error)
		throw error
	}
}

export async function getSsmParameters(names: string[]): Promise<Record<string, string>> {
	try {
		const command = new GetParametersCommand({
			Names: names,
			WithDecryption: true // Decrypt SecureString parameters
		})

		const response = await ssmClient.send(command)
		const parameters: Record<string, string> = {}

		response.Parameters?.forEach(param => {
			if (param.Name && param.Value) {
				parameters[param.Name] = param.Value
			}
		})

		return parameters
	} catch (error) {
		console.error('Error fetching SSM parameters:', error)
		throw error
	}
}

export async function getSsmParametersByPath(path: string): Promise<Record<string, string>> {
	try {
		const allParams: Record<string, string> = {}
		let nextToken: string | undefined

		do {
			const command = new GetParametersByPathCommand({
				Path: path,
				WithDecryption: true,
				NextToken: nextToken,
				Recursive: true
			})

			const response = await ssmClient.send(command)

			response.Parameters?.forEach(param => {
				if (param.Name && param.Value) {
					// Remove the path prefix for cleaner keys
					const key = param.Name.replace(path, '').replace(/^\//, '')
					allParams[key] = param.Value
				}
			})

			nextToken = response.NextToken
		} while (nextToken)

		return allParams
	} catch (error) {
		console.error(`Error fetching SSM parameters from path ${path}:`, error)
		throw error
	}
}