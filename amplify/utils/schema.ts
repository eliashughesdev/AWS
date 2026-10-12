import Ajv, { type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'

// Request body schemas live in amplify/service/schemas/, one JSON file per route
const ajv = new Ajv()
// Only the formats the schemas use; a schema naming another one fails to compile
addFormats(ajv, ['email'])
const compiled = new WeakMap<object, ValidateFunction>()

export type SchemaCheck =
  | { valid: true }
  | { valid: false, code: 100029 | 100031, message: string }

// A missing required field answers 100029 with every required field, as requiredParams did;
// any other mismatch answers 100031 with the path of the offending value
export const checkBodyAgainstSchema = (body: unknown, schema: Record<string, any>): SchemaCheck => {
  let validate = compiled.get(schema)
  if (!validate) {
    validate = ajv.compile(schema)
    compiled.set(schema, validate)
  }
  if (validate(body)) return { valid: true }

  const error = validate.errors![0]
  if (error.keyword === 'required' && error.instancePath === '') {
    return { valid: false, code: 100029, message: (schema.required as string[]).join(',') }
  }
  return { valid: false, code: 100031, message: error.instancePath.slice(1).replace(/\//g, '.') || 'body' }
}
