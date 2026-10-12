import Ajv, { type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'

// Request body schemas live in amplify/service/schemas/, one JSON file per route
// verbose: a required error then carries its level's whole required list
const ajv = new Ajv({ verbose: true })
// Only the formats the schemas use; a schema naming another one fails to compile
addFormats(ajv, ['email', 'date-time'])
const compiled = new WeakMap<object, ValidateFunction>()

export type SchemaCheck =
  | { valid: true }
  | { valid: false, code: 100029 | 100031, message: string }

// A missing required field answers 100029 with every required field at its level, as
// requiredParams did (nested ones by path: transaction.id); any other mismatch answers 100031
// with the path of the offending value
export const checkBodyAgainstSchema = (body: unknown, schema: Record<string, any>): SchemaCheck => {
  let validate = compiled.get(schema)
  if (!validate) {
    validate = ajv.compile(schema)
    compiled.set(schema, validate)
  }
  if (validate(body)) return { valid: true }

  const error = validate.errors![0]
  const path = error.instancePath.slice(1).replace(/\//g, '.')
  if (error.keyword === 'required') {
    const prefix = path ? `${path}.` : ''
    return { valid: false, code: 100029, message: (error.schema as string[]).map(field => prefix + field).join(',') }
  }
  return { valid: false, code: 100031, message: path || 'body' }
}
