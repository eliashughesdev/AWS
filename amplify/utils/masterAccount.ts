import { queryItemFromIndex } from './db'

// SSM env var holding the master (treasury) account NUMBER that swept token
// deposits are consolidated to and that signs token withdrawals, keyed by
// currency
const MASTER_ACCOUNT_ENV_VARS: Record<string, string> = {
  USDT_TRON: 'USDT_TRON_MASTER_ACCOUNT_NUMBER',
  TEST_USDT_TRON: 'USDT_TRON_MASTER_ACCOUNT_NUMBER',
}

export interface MasterAccount {
  depositAddress: string
  kmsKeyId: string
}

export async function getMasterAccount(currency?: string): Promise<MasterAccount | null> {
  const envVar = currency ? MASTER_ACCOUNT_ENV_VARS[currency.toUpperCase()] : undefined
  const accountNumber = envVar ? process.env[envVar] : undefined
  if (!accountNumber) return null

  const result = await queryItemFromIndex({
    tableName: 'v2CustomerTable',
    indexName: 'v1v2CustomerTableToAccountId',
    keyConditionExpression: '#sk = :accountNumber',
    attributeNames: { '#sk': 'sk' },
    attributeValues: { ':accountNumber': `ACCOUNT#${accountNumber}` },
  })

  const record = result.success ? result.res?.[0] : undefined
  if (!record?.depositAddress || !record?.kmsKeyId) return null

  return { depositAddress: record.depositAddress, kmsKeyId: record.kmsKeyId }
}
