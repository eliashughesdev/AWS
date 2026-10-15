// Matching a request's path against the router's paths, some of which are templates holding
// {name} placeholders: /accounts/{id}, /withdrawals/{id}/cancel (docs/public-api-plan.md D6.2).
//
// A placeholder takes one whole, non-empty segment, never a slash. A path the router knows as it
// is always wins over a template, as API Gateway does: /accounts/list is never /accounts/{id}.

const PLACEHOLDER = /^\{(\w+)\}$/

export const isTemplate = (path: string) => path.split('/').some(segment => PLACEHOLDER.test(segment))

// A template's placeholder names, in order
export const placeholdersOf = (template: string) =>
  template.split('/').flatMap(segment => PLACEHOLDER.exec(segment)?.[1] ?? [])

// The values a path gives a template's placeholders, or null when it does not fit
export const matchTemplate = (template: string, path: string): Record<string, string> | null => {
  const wanted = template.split('/')
  const given = path.split('/')
  if (wanted.length !== given.length) return null

  const params: Record<string, string> = {}
  for (const [i, segment] of wanted.entries()) {
    const name = PLACEHOLDER.exec(segment)?.[1]
    if (name) {
      if (!given[i]) return null
      params[name] = given[i]
    } else if (segment !== given[i]) {
      return null
    }
  }
  return params
}

// Of two templates a path fits, the one with fewer placeholders wins, then the one whose first
// placeholder comes later: /accounts/{id}/deposit-address over /accounts/{id}/{field}
export const moreSpecificFirst = (a: string, b: string) => {
  const holes = (template: string) => template.split('/').map(segment => PLACEHOLDER.test(segment))
  const [ha, hb] = [holes(a), holes(b)]
  const count = (h: boolean[]) => h.filter(Boolean).length
  if (count(ha) !== count(hb)) return count(ha) - count(hb)
  return hb.indexOf(true) - ha.indexOf(true)
}
