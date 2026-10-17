import { provisionCustodialAccount } from './custodialAccount'
import { ProviderName } from '../providers/ledger/ProviderName'

jest.mock('./masterAccount', () => ({ canHoldCurrency: async () => true }))
jest.mock('./hdSigner', () => ({
  createSeed: async () => {},
  allocateAddress: async () => ({ derivationIndex: 7, address: 'TAddress' }),
}))
jest.mock('./AccountProvider', () => ({
  ProviderRegistry: {
    getProvider: () => ({
      createVaAccount: async () => ({ accountId: 'va-1' }),
      assignDepositAddress: async ({ address }: { address: string }) => ({ address }),
      createSubscription: async () => ({ subscriptionId: 'sub-1' }),
    }),
  },
}))

const provision = (name?: string) => provisionCustodialAccount({
  userId: 'user-1',
  chain: 'TRON',
  provider: ProviderName.Tatum,
  accountingCurrency: 'USD',
  merchantId: 'internal-001',
  name,
})

describe('provisionCustodialAccount account name', () => {
  it('stores the name on the account record, trimmed', async () => {
    expect((await provision('  Savings ')).accountRecord.name).toBe('Savings')
  })

  it.each([
    ['none is given', undefined],
    ['it is empty', ''],
    ['it is blank', '   '],
  ])('stores no name when %s', async (_, name) => {
    expect((await provision(name)).accountRecord).not.toHaveProperty('name')
  })
})
