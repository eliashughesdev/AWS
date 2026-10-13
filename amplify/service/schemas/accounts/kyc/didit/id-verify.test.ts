import { checkBodyAgainstSchema } from '../../../../../utils/schema'
import schema from './id-verify.json'

const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]).toString('base64')
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /accounts/kyc/didit/id-verify body', () => {
  it.each([
    ['both sides', { front_image: image, back_image: image }],
    // KycIdUpload.tsx leaves back_image undefined, which JSON drops
    ['the front alone', { front_image: image }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it('requires front_image', () => {
    expect(checkBodyAgainstSchema({ back_image: image }, schema)).toEqual({ valid: false, code: 100029, message: 'front_image' })
  })

  it.each([
    ['an empty front', { front_image: '' }, 'front_image'],
    // The page strips it; the handler would decode it as part of the image
    ['a data URL', { front_image: `data:image/jpeg;base64,${image}` }, 'front_image'],
    ['text that is not base64', { front_image: 'not an image!' }, 'front_image'],
    ['a front image as an object', { front_image: { data: image } }, 'front_image'],
    ['an empty back', { front_image: image, back_image: '' }, 'back_image'],
    ['a null back', { front_image: image, back_image: null }, 'back_image'],
  ])('refuses %s', (_, body, field) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual(invalid(field))
  })
})
