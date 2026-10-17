import { isPermission, permissions, type Permission } from './permissions'
import { publicRoutes } from './publicRoutes'
import { routeAt } from './router'

const entries = Object.entries(permissions) as [Permission, (typeof permissions)[Permission]][]
const keyRoutes = publicRoutes.filter(r => r.auth === 'custom')

// docs/public-api-plan.md step 1.2: an API key is checked against the permission its route names
describe('public routes', () => {
  it.each(keyRoutes.map(r => [r.method, r.path, r]))('%s %s names a known permission, any or null', (_m, _p, route) => {
    expect(route).toHaveProperty('permission')
    const { permission } = route as { permission: unknown }
    expect(permission === null || permission === 'any' || isPermission(permission)).toBe(true)
  })

  it('leaves the routes that take no key without a permission', () => {
    for (const route of publicRoutes.filter(r => r.auth === 'none')) expect(route).not.toHaveProperty('permission')
  })

  it('opens a route to every key only for GET /me', () => {
    expect(keyRoutes.filter(r => r.permission === 'any').every(r => r.method === 'GET' && r.path === '/me')).toBe(true)
  })

  it('names a user\'s permission on user routes and a merchant\'s on merchant routes', () => {
    for (const route of keyRoutes) {
      if (!isPermission(route.permission)) continue
      // Only a merchant's key (role admin) may call onboarding and its resend
      const merchantOnly = routeAt(route.path, route.method)?.allowedRoles?.every(role => role === 'admin') ?? false
      expect([route.path, permissions[route.permission].owner]).toEqual([route.path, merchantOnly ? 'merchant' : 'user'])
    }
  })

  it('names a Move money permission on each route that moves money', () => {
    const groupOf = (path: string) => {
      const permission = keyRoutes.find(r => r.path === path)?.permission
      return isPermission(permission) ? permissions[permission].group : undefined
    }
    expect(['/accounts/transfer', '/accounts/withdraw', '/accounts/deposit'].map(groupOf))
      .toEqual(['move-money', 'move-money', 'move-money'])
  })

  it('lets no key add a payment card (D1.9)', () => {
    expect(keyRoutes.find(r => r.path === '/payments/save')?.permission).toBeNull()
  })

  it('names a public route for every route a key could reach', () => {
    for (const route of keyRoutes) expect(routeAt(route.path, route.method)).toBeDefined()
  })
})

describe('permissions', () => {
  it('never moves money with a read', () => {
    for (const [name, info] of entries.filter(([name]) => name.endsWith(':read'))) {
      expect([name, info.group]).toEqual([name, info.owner === 'merchant' ? 'users' : 'view'])
    }
  })

  it('gives a merchant only users:*', () => {
    for (const [name, info] of entries) expect([name, info.owner === 'merchant']).toEqual([name, name.startsWith('users:')])
  })

  it('knows its own names and nothing else', () => {
    expect(isPermission('accounts:read')).toBe(true)
    expect(isPermission('accounts:delete')).toBe(false)
    expect(isPermission('any')).toBe(false)
    expect(isPermission('toString')).toBe(false)
    expect(isPermission(undefined)).toBe(false)
  })
})
