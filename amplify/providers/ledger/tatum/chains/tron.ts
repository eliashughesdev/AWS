import axios from 'axios'
import '../../../../utils/redactAxios' // keeps the API key out of logged errors
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

// A well-formed TRON address: base58check, 25 bytes, 0x41 prefix, valid checksum
export function isValidTronAddress(address: unknown): boolean {
  if (typeof address !== 'string') return false
  try {
    const payload = bs58.decode(address)
    return payload.length === 25 && payload[0] === 0x41 && decodeTronAddressHex(address).length === 40
  } catch {
    return false
  }
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

// java-tron (BandwidthProcessor.consume) charges the signed transaction without
// its `ret`, plus this reserve per contract for the result
const TRON_RESULT_RESERVE_BYTES = 64

// Bytes a protobuf varint takes for n
function varintBytes(n: number): number {
  let bytes = 1
  for (; n >= 128; n = Math.floor(n / 128)) bytes++
  return bytes
}

// raw_data (field 1) and each signature (field 2), length-prefixed, plus the reserve
function bandwidthForRaw(rawBytes: number, signatures: number): number {
  const signature = 1 + varintBytes(TRON_SIGNATURE_BYTES) + TRON_SIGNATURE_BYTES
  return 1 + varintBytes(rawBytes) + rawBytes + signatures * signature + TRON_RESULT_RESERVE_BYTES
}

// The exact bandwidth a one-contract transaction costs once signed: its receipt's
// net_usage, or net_fee / price when burned. estimateTronBandwidth pads instead.
export function tronBandwidthBytes(unsignedTx: Pick<UnsignedTronTransaction, 'raw_data_hex'>, signatures = 1): number {
  return bandwidthForRaw(unsignedTx.raw_data_hex.length / 2, signatures)
}

type BandwidthPools = Pick<TronResources, 'freeBandwidthAvailable' | 'stakedBandwidthAvailable'>

// A pool pays only when it alone covers every byte (see getTronResources)
export function tronBandwidthCovered(resources: BandwidthPools, bytes: number): boolean {
  return resources.stakedBandwidthAvailable >= bytes || resources.freeBandwidthAvailable >= bytes
}

// The sun burned for a transfer to an active address. Activating one costs more:
// 1 TRX, plus 0.1 TRX instead of this when the sender has no staked bandwidth.
export function tronBandwidthFeeSun(bytes: number, resources: BandwidthPools, priceSun: number): number {
  return tronBandwidthCovered(resources, bytes) ? 0 : bytes * priceSun
}

export interface TronSweepAmount {
  amountSun: number
  feeSun: number
}

// The most a whole-balance transfer can send, and its fee. `rawBytes` is raw_data's
// size when built for the whole balance. The amount is a varint, so a smaller one
// can shorten the transaction by a byte and change the fee: each length is tried,
// and the one that leaves the least behind wins. That is 0, unless the balance
// sits just above a length boundary (2^21, 2^28 sun...) where no amount fits.
// null when the balance can't pay the fee.
export function tronSweepAmount(balanceSun: number, rawBytes: number, resources: BandwidthPools, priceSun: number): TronSweepAmount | null {
  const rawWithoutAmount = rawBytes - varintBytes(balanceSun)
  let best: TronSweepAmount | null = null
  for (let length = 1; length <= varintBytes(balanceSun); length++) {
    const feeSun = tronBandwidthFeeSun(bandwidthForRaw(rawWithoutAmount + length, 1), resources, priceSun)
    const amountSun = Math.min(balanceSun - feeSun, 128 ** length - 1)
    if (amountSun < 128 ** (length - 1)) continue
    if (!best || amountSun + feeSun > best.amountSun + best.feeSun) best = { amountSun, feeSun }
  }
  return best
}

// An unsigned native TRX transfer, built by the node
export async function buildTronTransfer(ownerAddress: string, toAddress: string, amountSun: number): Promise<UnsignedTronTransaction> {
  const url = `${resolveBase()}/blockchain/node/TRON/wallet/createtransaction`
  const res = await axios.post(
    url,
    { owner_address: ownerAddress, to_address: toAddress, amount: amountSun, visible: true },
    { headers: { 'x-api-key': process.env.TATUM_API_KEY } }
  )
  if (!res.data?.txID) throw new Error(`TRON node did not build the transfer ${ownerAddress} -> ${toAddress}: ${JSON.stringify(res.data)}`)
  return res.data
}

export interface TronSweep extends TronSweepAmount {
  tx: UnsignedTronTransaction
}

// The unsigned transaction that sends ownerAddress's whole balance minus the exact
// fee to toAddress, which must be active (isTronAccountActive). null when the
// balance can't pay the fee.
export async function buildTronSweep(ownerAddress: string, toAddress: string): Promise<TronSweep | null> {
  const [balance, resources, priceSun] = await Promise.all([
    getTronBalance(ownerAddress), getTronResources(ownerAddress), getTronBandwidthPriceSun(),
  ])
  if (!priceSun) throw new Error('TRON bandwidth price (getTransactionFee) is unavailable')
  const balanceSun = Math.round(balance * SUN_PER_TRX)
  if (balanceSun <= 0) return null

  const whole = await buildTronTransfer(ownerAddress, toAddress, balanceSun)
  const sweep = tronSweepAmount(balanceSun, whole.raw_data_hex.length / 2, resources, priceSun)
  if (!sweep) return null
  const tx = sweep.amountSun === balanceSun ? whole : await buildTronTransfer(ownerAddress, toAddress, sweep.amountSun)

  const feeSun = tronBandwidthFeeSun(tronBandwidthBytes(tx), resources, priceSun)
  if (feeSun !== sweep.feeSun) throw new Error(`TRON sweep of ${ownerAddress} was built with a fee of ${feeSun} sun, not the ${sweep.feeSun} computed`)
  return { ...sweep, tx }
}

// wallet/getaccount answers {} for an address that never received anything
export async function isTronAccountActive(address: string): Promise<boolean> {
  const url = `${resolveBase()}/blockchain/node/TRON/wallet/getaccount`
  const res = await axios.post(url, { address, visible: true }, { headers: { 'x-api-key': process.env.TATUM_API_KEY } })
  return Boolean(res.data?.address)
}

// The TRX the chain burned for a transaction (bandwidth, energy, activation), or
// null while it isn't in a block. The node leaves `fee` out when it is 0.
export async function getTronTransactionFee(txId: string): Promise<number | null> {
  const url = `${resolveBase()}/blockchain/node/TRON/wallet/gettransactioninfobyid`
  const res = await axios.post(url, { value: txId }, { headers: { 'x-api-key': process.env.TATUM_API_KEY } })
  if (!res.data?.id) return null
  return Number(res.data.fee ?? 0) / SUN_PER_TRX
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