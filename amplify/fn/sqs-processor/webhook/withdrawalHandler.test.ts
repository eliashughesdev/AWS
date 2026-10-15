import { handleWithdrawal } from './withdrawalHandler'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { BroadcastUncertainError } from '../../../providers/ledger/provider'
import { settleOperation } from '../../../utils/operations'
import { putItem, updateItem } from '../../../utils/db'

jest.mock('../../../utils/db', () => ({ putItem: jest.fn(async () => ({ success: true })), updateItem: jest.fn(async () => ({ success: true })) }))
jest.mock('../../../utils/AccountProvider', () => ({ ProviderRegistry: { getProvider: jest.fn() } }))
jest.mock('../../../utils/websocket', () => ({ notifyPaymentResult: jest.fn() }))
jest.mock('../../../utils/masterAccount', () => ({ getMasterAccount: jest.fn() }))
jest.mock('../../../utils/signing', () => ({ accountKeyRef: jest.fn(() => 'key-ref') }))
jest.mock('../../../utils/custodialAccount', () => ({
  findAccountForUser: jest.fn(async () => ({ id: 'user-1', vAccountId: 'va-1', chain: 'TRON', depositAddress: 'T-own', merchantId: 'internal-001' })),
}))
jest.mock('../../../utils/operations', () => ({ settleOperation: jest.fn() }))

const withdrawFunds = jest.fn()
const message = { transactionId: 'wdr_1', userId: 'user-1', vAccountId: 'va-1', cryptoAmount: 5, destinationAddress: 'T-dest' }

beforeEach(() => {
  for (const level of ['log', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {})
  jest.mocked(ProviderRegistry.getProvider).mockReturnValue({ withdrawFunds } as any)
})
afterEach(() => jest.clearAllMocks())

// docs/public-api-plan.md step 1.5: the withdrawal's record follows what the queue learnt
describe('handleWithdrawal: the withdrawal\'s record', () => {
  it('completes it with the chain\'s transaction id', async () => {
    withdrawFunds.mockResolvedValue({ withdrawalId: 'w-1', txId: '0xabc' })
    expect(await handleWithdrawal(message)).toBe(true)
    expect(settleOperation).toHaveBeenCalledWith('user-1', 'wdr_1', { status: 'completed', txId: '0xabc' })
  })

  it('keeps it pending, never failed, when the broadcast\'s outcome is unknown, and refunds nothing', async () => {
    withdrawFunds.mockRejectedValue(new BroadcastUncertainError('w-1', new Error('timeout')))
    await handleWithdrawal(message)
    expect(settleOperation).toHaveBeenCalledWith('user-1', 'wdr_1', { status: 'pending', stage: 'uncertain' })
    expect(updateItem).not.toHaveBeenCalled()
  })

  it('fails it once the payout provably failed and the balance came back', async () => {
    withdrawFunds.mockRejectedValue(new Error('node refused'))
    await handleWithdrawal(message)
    expect(updateItem).toHaveBeenCalledTimes(1)
    expect(settleOperation).toHaveBeenCalledWith('user-1', 'wdr_1', { status: 'failed' })
    expect(putItem).toHaveBeenCalledWith('v1TransactionLogsTable', expect.objectContaining({ type: 'WITHDRAWAL_FAILED' }))
  })
})
