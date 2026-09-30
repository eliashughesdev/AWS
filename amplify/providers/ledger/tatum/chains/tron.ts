import axios from 'axios'
import bs58 from 'bs58'
import { createHash } from 'crypto'
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
  freeBandwidthAvailable: number
  stakedBandwidthAvailable: number
}

// get energy and bandwith resources from a given address
export async function getTronResources(address: string): Promise<TronResources> {
    const url = `${resolveBase()}/blockchain/node/TRON/wallet/getaccountresource`
    const res = await axios.post(url, { address, visible: true }, { headers: { 'x-api-key': process.env.TATUM_API_KEY } })
    const energyLimit = Number(res.data?.EnergyLimit ?? 0)
    const energyUsed = Number(res.data?.EnergyUsed ?? 0)
    // Bandwidth has two pools: staked/delegated (NetLimit/NetUsed) and the free
    // daily allowance (freeNetLimit/freeNetUsed). They never combine: the chain
    // tries each in turn and a pool is only used if it covers the whole tx on its
    // own, otherwise TRX is burned (java-tron BandwidthProcessor.consume).
    const freeNetLimit = Number(res.data?.freeNetLimit ?? 0)
    const freeNetUsed = Number(res.data?.freeNetUsed ?? 0)
    const netLimit = Number(res.data?.NetLimit ?? 0)
    const netUsed = Number(res.data?.NetUsed ?? 0)
    return {
      energyLimit,
      energyAvailable: energyLimit - energyUsed,
      freeBandwidthAvailable: freeNetLimit - freeNetUsed,
      stakedBandwidthAvailable: netLimit - netUsed,
    }
}

let bandwidthPriceSun: number | undefined

export async function getTronBandwidthPriceSun(): Promise<number | undefined> {
    if (bandwidthPriceSun) return bandwidthPriceSun
    const url = `${resolveBase()}/blockchain/node/TRON/wallet/getchainparameters`
    const res = await axios.get(url, { headers: { 'x-api-key': process.env.TATUM_API_KEY } })
    const param = res.data?.chainParameter?.find((p: any) => p.key === 'getTransactionFee')
    bandwidthPriceSun = param?.value ? Number(param.value) : undefined
    return bandwidthPriceSun
}

const TRANSFER_SELECTOR = 'transfer(address,uint256)'

// Decodes a TRON base58check address (T...) to its raw 20-byte hex form.
function decodeTronAddressHex(base58Address: string): string {
  const payload = bs58.decode(base58Address) // 21-byte prefixed address + 4-byte checksum
  const prefixed = payload.subarray(0, 21)
  const checksum = payload.subarray(21, 25)

  const firstHash = createHash('sha256').update(prefixed).digest()
  const expectedChecksum = createHash('sha256').update(firstHash).digest().subarray(0, 4)
  if (!Buffer.from(checksum).equals(expectedChecksum)) {
    throw new Error(`Invalid TRON address checksum: ${base58Address}`)
  }

  return Buffer.from(prefixed.subarray(1)).toString('hex') // drop 0x41, hex-encode the 20 bytes
}

function encodeTransferParameter(toAddress: string, amountUnits: number): string {
  const addressHex = decodeTronAddressHex(toAddress).padStart(64, '0')
  const amountHex = amountUnits.toString(16).padStart(64, '0')
  return addressHex + amountHex
}

export interface UnsignedTronTransaction {
  txID: string
  raw_data: unknown
  raw_data_hex: string
  visible: boolean
}

// Read-only dry run (wallet/triggerconstantcontract) — simulates the transfer
// against current chain state with no fee, no signature, no broadcast, and
// reports back how much Energy it would actually cost.
export async function estimateTrc20TransferEnergy(
  contractAddress: string,
  ownerAddress: string,
  toAddress: string,
  amountUnits: number
): Promise<number> {
  const url = `${resolveBase()}/blockchain/node/TRON/wallet/triggerconstantcontract`
  const res = await axios.post(
    url,
    {
      owner_address: ownerAddress,
      contract_address: contractAddress,
      function_selector: TRANSFER_SELECTOR,
      parameter: encodeTransferParameter(toAddress, amountUnits),
      visible: true,
    },
    { headers: { 'x-api-key': process.env.TATUM_API_KEY } }
  )

  if (!res.data?.result?.result) {
    throw new Error(`TRC-20 transfer simulation reverted for ${ownerAddress} -> ${toAddress}: ${JSON.stringify(res.data?.result)}`)
  }
  return Number(res.data.energy_used ?? 0)
}

// Builds a real, signable TRC-20 transfer transaction (wallet/
// triggersmartcontract)
export async function buildTrc20Transfer(
  contractAddress: string,
  ownerAddress: string,
  toAddress: string,
  amountUnits: number,
  feeLimitSun: number
): Promise<UnsignedTronTransaction> {
  const url = `${resolveBase()}/blockchain/node/TRON/wallet/triggersmartcontract`
  const res = await axios.post(
    url,
    {
      owner_address: ownerAddress,
      contract_address: contractAddress,
      function_selector: TRANSFER_SELECTOR,
      parameter: encodeTransferParameter(toAddress, amountUnits),
      fee_limit: feeLimitSun,
      call_value: 0,
      visible: true,
    },
    { headers: { 'x-api-key': process.env.TATUM_API_KEY } }
  )

  if (!res.data?.result?.result) {
    throw new Error(`TRC-20 transfer build reverted for ${ownerAddress} -> ${toAddress}: ${JSON.stringify(res.data?.result)}`)
  }
  const tx = res.data.transaction
  if (!tx?.txID) throw new Error('TRON node did not return a txID for the TRC-20 transaction')
  return tx
}

// One secp256k1 signature (r + s + v), the size of every KMS-signed TRON tx.
const TRON_SIGNATURE_BYTES = 65

// Padded, not measured: TRON has no dry-run bandwidth estimate the way
// triggerconstantcontract gives one for Energy, so this covers the protocol
// framing around raw_data (unlike Energy, Bandwidth is priced per byte and
// cheap to rent) — if a real shortfall is ever observed, raise this constant.
const TRON_BANDWIDTH_OVERHEAD_BYTES = 100

// Approximates the Bandwidth a signed transaction will consume, from the
// unsigned tx's actual byte size plus the signature that's about to be added.
export function estimateTronBandwidth(unsignedTx: UnsignedTronTransaction): number {
  const rawDataBytes = unsignedTx.raw_data_hex.length / 2
  return Math.ceil(rawDataBytes + TRON_SIGNATURE_BYTES + TRON_BANDWIDTH_OVERHEAD_BYTES)
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