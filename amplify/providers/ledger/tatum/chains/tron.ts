import axios from 'axios'
import { OnChainTransaction } from '../../provider'


const SUN_PER_TRX = 1_000_000

// Read lazily (not as module-level consts) — loadConfig() refreshes these from
// SSM at request time, after this module has already been imported at cold start.
function resolveBase(): string {
    return process.env.TATUM_BASE_URL || 'https://api.tatum.io/v3'
}

// Get /v3/tron/account/{address}
export async function getTronBalance(address: string): Promise<number> {
    const url = `${resolveBase()}/tron/account/${address}`
    const res = await axios.get(url, {headers: {'x-api-key': process.env.TATUM_API_KEY} })
    return Number(res.data?.balance ?? 0)/ SUN_PER_TRX
}

export interface TronResources {
  energyLimit: number
  energyAvailable: number
}

// get energy and bandwith resources from a given address
export async function getTronResources(address: string): Promise<TronResources> {
    const url = `${resolveBase()}/blockchain/node/TRON/wallet/getaccountresource`
    const res = await axios.post(url, { address, visible: true }, { headers: { 'x-api-key': process.env.TATUM_API_KEY } })
    const energyLimit = Number(res.data?.EnergyLimit ?? 0)
    const energyUsed = Number(res.data?.EnergyUsed ?? 0)
    return { energyLimit, energyAvailable: energyLimit - energyUsed }
}

//Maps one TronGrid-native tx to our normilized shape. NiativTRX transfers only
// (TranferContract) - TRC20/other contract calls are ignored for now
function mapTronTransfer(tx: any, watched: string): OnChainTransaction | null {
  const contract = tx.rawData?.contract?.[0]
  if (!contract || contract.type !== 'TransferContract') return null   // native TRX only

  const v = contract.parameter?.value ?? {}
  const from = v.ownerAddressBase58 ?? v.owner_address   // prefer base58 twin
  const to   = v.toAddressBase58 ?? v.to_address
  const magnitude = Number(v.amount ?? 0) / SUN_PER_TRX  // amount is SUN
  const isOutgoing = from === watched

  return {
    txId: tx.txID,
    amount: isOutgoing ? -magnitude : magnitude,
    currency: 'TRON',
    from,
    to,
    blockNumber: tx.blockNumber,
    timestamp: tx.rawData?.timestamp,   // ms epoch
  }
}

// GET /v3/tron transacction/acount/{address} - 200 trx per page paginated
// by a next field if it appears in the response then there is more transaction
// to process send it as an url argument on the next call to the method
export async function getTronHistory(address: string): Promise<OnChainTransaction[]> {
    const results: OnChainTransaction[] = [] 
    let next: string | undefined

    do {
        const url = `${resolveBase()}/tron/transaction/account/${address}`
        + `?orderBy=block_timestamp,desc`
        + (next ? `&next=${next}` : '')

        const res = await axios.get(url, {headers: {'x-api-key': process.env.TATUM_API_KEY}})
        const page = res.data?.transactions ?? res.data ?? []

        for (const tx of page) {
            const mapped = mapTronTransfer(tx, address)
            if (mapped) results.push(mapped)
        }

        next = res.data?.next
    } while (next)

        return results
}