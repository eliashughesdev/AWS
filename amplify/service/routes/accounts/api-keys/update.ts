import { unmarshall } from '@aws-sdk/util-dynamodb'
import { response } from '../../../../utils/http'
import { processError } from '../../../../errors/http'
import { checkAllowlist, checkPermissions, keyView, signedInOnly } from '../../../../utils/apiKeys'
import { API_KEYS_TABLE } from '../../../../utils/apiKeyStore'
import { updateItem } from '../../../../utils/db'

type Event = {
  requestContext?: { authorizer?: { userId?: string, authType?: string } }
  body: { keyId: string, name?: string, permissions?: string[], ipAllowlist?: string[] }
}

/**
 * Changes one of the caller's own active keys: name, permissions, IP allowlist (D2.6). An empty
 * allowlist lets any IP use the key again. Applies on the key's next call: the authorizer reads
 * the row every time. Someone else's key, a revoked one or one that does not exist: 100060.
 */
export default class UpdateApiKeyHandler {
  async execute(event: Event) {
    const caller = signedInOnly(event.requestContext?.authorizer)
    if (caller.error) return caller.error
    const { keyId, name, permissions, ipAllowlist } = event.body

    const sets: string[] = ['updatedAt = :now']
    const removes: string[] = []
    const values: Record<string, any> = { ':now': new Date().toISOString(), ':owner': caller.userId, ':active': 'active' }
    if (name !== undefined) {
      sets.push('#name = :name')
      values[':name'] = name.trim()
    }
    if (permissions !== undefined) {
      const granted = checkPermissions(permissions, 'user')
      if (granted.error) return granted.error
      sets.push('#permissions = :permissions')
      values[':permissions'] = [...granted.permissions!].sort()
    }
    if (ipAllowlist !== undefined) {
      const allowlist = checkAllowlist(ipAllowlist)
      if (allowlist.error) return allowlist.error
      if (allowlist.ips!.length) {
        sets.push('ipAllowlist = :ips')
        values[':ips'] = allowlist.ips
      } else {
        removes.push('ipAllowlist')
      }
    }

    const updated = await updateItem({
      tableName: API_KEYS_TABLE,
      key: { id: keyId },
      updateExpression: `SET ${sets.join(', ')}${removes.length ? ` REMOVE ${removes.join(', ')}` : ''}`,
      conditionExpression: 'ownerId = :owner AND #status = :active',
      attributeNames: {
        '#status': 'status',
        ...(name !== undefined ? { '#name': 'name' } : {}),
        ...(permissions !== undefined ? { '#permissions': 'permissions' } : {}),
      },
      attributeValues: values,
      returnValues: 'ALL_NEW',
    })
    if (!updated.success) {
      if (updated.error?.name === 'ConditionalCheckFailedException') return processError(100060, undefined, 404)
      return processError(100003)
    }
    const row = unmarshall((updated.res as any)?.Attributes ?? {})
    console.log(`API_KEY: ${keyId} changed by its owner (${[name !== undefined && 'name', permissions !== undefined && 'permissions', ipAllowlist !== undefined && 'ipAllowlist'].filter(Boolean).join(', ')})`)
    return response({ statusCode: 200, headers: null, bodyObject: { success: true, key: keyView(row) } })
  }
}
