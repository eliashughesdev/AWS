import { isTemplate, matchTemplate, moreSpecificFirst, placeholdersOf } from './routeMatch'

// docs/public-api-plan.md step 1.3
describe('matchTemplate', () => {
  it('captures each placeholder\'s segment', () => {
    expect(matchTemplate('/accounts/{id}', '/accounts/PCF0001ab')).toEqual({ id: 'PCF0001ab' })
    expect(matchTemplate('/users/{userId}/cards/{cardId}', '/users/u1/cards/c2')).toEqual({ userId: 'u1', cardId: 'c2' })
  })

  it('answers no values for a path written as it is', () => {
    expect(matchTemplate('/accounts/list', '/accounts/list')).toEqual({})
  })

  it.each([
    ['another fixed segment', '/accounts/{id}', '/payments/abc'],
    ['an empty segment', '/accounts/{id}', '/accounts/'],
    ['a longer path: a placeholder never takes a slash', '/accounts/{id}', '/accounts/a/b'],
    ['a shorter path', '/accounts/{id}/deposit-address', '/accounts/abc'],
  ])('does not fit %s', (_, template, path) => {
    expect(matchTemplate(template, path)).toBeNull()
  })
})

describe('templates', () => {
  it('tells a template from a path', () => {
    expect(isTemplate('/accounts/{id}')).toBe(true)
    expect(isTemplate('/accounts/list')).toBe(false)
    expect(isTemplate('/accounts/{id')).toBe(false)
  })

  it('names the placeholders in order', () => {
    expect(placeholdersOf('/users/{userId}/cards/{cardId}')).toEqual(['userId', 'cardId'])
    expect(placeholdersOf('/accounts/list')).toEqual([])
  })

  it('puts the template with fewer placeholders first, then the one whose first comes later', () => {
    expect(['/accounts/{id}/{field}', '/accounts/{id}/deposit-address'].sort(moreSpecificFirst))
      .toEqual(['/accounts/{id}/deposit-address', '/accounts/{id}/{field}'])
    expect(['/{kind}/abc', '/accounts/{id}'].sort(moreSpecificFirst)).toEqual(['/accounts/{id}', '/{kind}/abc'])
  })
})
