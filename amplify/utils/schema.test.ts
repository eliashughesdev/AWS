import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { checkBodyAgainstSchema } from './schema'

const schema = {
  type: 'object',
  required: ['name', 'amount'],
  properties: {
    name: { type: 'string', minLength: 1 },
    amount: { type: 'number' },
    contact: { type: 'object', properties: { email: { type: 'string', format: 'email' } } },
  },
}

describe('checkBodyAgainstSchema', () => {
  it('accepts a body that matches', () => {
    expect(checkBodyAgainstSchema({ name: 'a', amount: 1 }, schema)).toEqual({ valid: true })
  })

  it('answers 100029 with every required field when one is missing', () => {
    expect(checkBodyAgainstSchema({ name: 'a' }, schema)).toEqual({ valid: false, code: 100029, message: 'name,amount' })
  })

  it('answers 100031 with the field when a value is wrong', () => {
    expect(checkBodyAgainstSchema({ name: '', amount: 1 }, schema)).toEqual({ valid: false, code: 100031, message: 'name' })
    expect(checkBodyAgainstSchema({ name: 'a', amount: '1' }, schema)).toEqual({ valid: false, code: 100031, message: 'amount' })
  })

  it('answers 100029 with the dotted paths of a nested level\'s required fields', () => {
    const nested = { type: 'object', properties: { contact: { type: 'object', required: ['email', 'phone'] } } }
    expect(checkBodyAgainstSchema({ contact: { phone: '1' } }, nested))
      .toEqual({ valid: false, code: 100029, message: 'contact.email,contact.phone' })
  })

  describe('a oneOf of required fields', () => {
    const either = {
      type: 'object',
      properties: { amount: { type: 'number', exclusiveMinimum: 0 }, cryptoAmount: { type: 'number' } },
      oneOf: [{ required: ['amount'] }, { required: ['cryptoAmount'] }],
    }

    it('accepts one', () => {
      expect(checkBodyAgainstSchema({ amount: 1 }, either)).toEqual({ valid: true })
      expect(checkBodyAgainstSchema({ cryptoAmount: 1 }, either)).toEqual({ valid: true })
    })

    it('answers 100029 naming the alternatives when none was sent', () => {
      expect(checkBodyAgainstSchema({}, either)).toEqual({ valid: false, code: 100029, message: 'amount or cryptoAmount' })
    })

    it('answers 100031 when both were sent', () => {
      expect(checkBodyAgainstSchema({ amount: 1, cryptoAmount: 1 }, either))
        .toEqual({ valid: false, code: 100031, message: 'amount or cryptoAmount: send only one' })
    })

    it('still names a bad value in the one sent', () => {
      expect(checkBodyAgainstSchema({ amount: -1 }, either)).toEqual({ valid: false, code: 100031, message: 'amount' })
    })
  })

  it('names a nested field by its dotted path', () => {
    expect(checkBodyAgainstSchema({ name: 'a', amount: 1, contact: { email: 'nope' } }, schema))
      .toEqual({ valid: false, code: 100031, message: 'contact.email' })
  })

  it('names a field that additionalProperties forbids, not the whole body', () => {
    const closed = { type: 'object', properties: { inner: { type: 'object', additionalProperties: false } }, additionalProperties: false }
    expect(checkBodyAgainstSchema({ userId: 'x' }, closed)).toEqual({ valid: false, code: 100031, message: 'userId' })
    expect(checkBodyAgainstSchema({ inner: { userId: 'x' } }, closed)).toEqual({ valid: false, code: 100031, message: 'inner.userId' })
  })

  it('answers 100031 for a missing or non-object body instead of throwing', () => {
    expect(checkBodyAgainstSchema(null, schema)).toEqual({ valid: false, code: 100031, message: 'body' })
    expect(checkBodyAgainstSchema(undefined, schema)).toEqual({ valid: false, code: 100031, message: 'body' })
    expect(checkBodyAgainstSchema('text', schema)).toEqual({ valid: false, code: 100031, message: 'body' })
  })

  it('refuses a format that is not registered', () => {
    expect(() => checkBodyAgainstSchema({}, { type: 'object', properties: { u: { type: 'string', format: 'uri' } } })).toThrow()
  })
})

// A typo in a schema, or a format not registered in schema.ts, would otherwise fail on the first request
describe('every schema under amplify/service/schemas', () => {
  const root = join(__dirname, '../service/schemas')
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.json'))

  it.each(files)('%s compiles', file => {
    const route = JSON.parse(readFileSync(join(root, file), 'utf8'))
    expect(() => checkBodyAgainstSchema({}, route)).not.toThrow()
  })
})
