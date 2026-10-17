import { frontendAppUrl } from './config'

describe('frontendAppUrl', () => {
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://my.example.com'
    delete process.env.FRONTEND_APP_PATH
  })

  it('is the /v2 folder when FRONTEND_APP_PATH is unset or blank', () => {
    expect(frontendAppUrl()).toBe('https://my.example.com/v2')
    process.env.FRONTEND_APP_PATH = ''
    expect(frontendAppUrl()).toBe('https://my.example.com/v2')
    process.env.FRONTEND_APP_PATH = '  '
    expect(frontendAppUrl()).toBe('https://my.example.com/v2')
  })

  it.each(['/noda', 'noda', '/noda/', ' /noda '])('takes the folder written as "%s"', (path) => {
    process.env.FRONTEND_APP_PATH = path
    expect(frontendAppUrl()).toBe('https://my.example.com/noda')
  })

  it('keeps a folder inside a folder', () => {
    process.env.FRONTEND_APP_PATH = '/apps/noda/'
    expect(frontendAppUrl()).toBe('https://my.example.com/apps/noda')
  })

  it('is the site root for "/"', () => {
    process.env.FRONTEND_APP_PATH = '/'
    expect(frontendAppUrl()).toBe('https://my.example.com')
  })

  it.each([
    [undefined, 'https://my.example.com/v2'],
    ['/noda', 'https://my.example.com/noda'],
    ['/', 'https://my.example.com'],
  ])('drops the slashes FRONTEND_URL ends in (path %s)', (path, expected) => {
    process.env.FRONTEND_URL = 'https://my.example.com//'
    if (path) process.env.FRONTEND_APP_PATH = path
    expect(frontendAppUrl()).toBe(expected)
  })

  it('is undefined without FRONTEND_URL, whatever the path', () => {
    delete process.env.FRONTEND_URL
    expect(frontendAppUrl()).toBeUndefined()
    process.env.FRONTEND_URL = ' '
    process.env.FRONTEND_APP_PATH = '/noda'
    expect(frontendAppUrl()).toBeUndefined()
  })
})
