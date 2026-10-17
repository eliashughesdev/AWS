/// <reference path="./tronweb.d.ts" />
import { TatumSDK, Network, type Tron } from '@tatumio/tatum'
import { TronWalletProvider } from '@tatumio/tron-wallet-provider'
import TronWeb from 'tronweb'
import type { OnChainTx } from './types'

const SUN_PER_TRX = 1_000_000
const MAX_HISTORY_TXS = 100

// Must match the network the backend/Tatum subscriptions run on. Defaults to
// TRON testnet (Shasta = "tron-testnet"); set VITE_TRON_NETWORK=mainnet for production.
function resolveTronNetwork(): Network {
  return import.meta.env.VITE_TRON_NETWORK === 'mainnet' ? Network.TRON : Network.TRON_SHASTA
}

// Public TronGrid node per network. Used for the tronweb broadcast path.
function resolveTronFullHost(): string {
  return import.meta.env.VITE_TRON_NETWORK === 'mainnet'
    ? 'https://api.trongrid.io'
    : 'https://api.shasta.trongrid.io'
}

async function getTatum() {
  return TatumSDK.init<Tron>({
    network: resolveTronNetwork(),
    configureWalletProviders: [TronWalletProvider],
  })
}

export interface TronWallet {
  address: string
  privateKey: string
  mnemonic: string
}

export async function generateTronWallet(): Promise<TronWallet> {
  const tatum = await getTatum()
  return tatum.walletProvider.use(TronWalletProvider).getWallet() as Promise<TronWallet>
}

// Key-based sign-in: the address is derived from the key locally, nothing is sent.
export function deriveTronAddress(privateKey: string): string {
  let address: string | false = false
  try {
    address = TronWeb.address.fromPrivateKey(privateKey.trim())
  } catch {
    throw new Error('Invalid private key')
  }
  if (!address) throw new Error('Invalid private key')
  return address
}

function describeTronError(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    const msg = typeof o.message === 'string' ? o.message : undefined
    const decoded = msg && /^[0-9a-fA-F]+$/.test(msg)
      ? (() => { try { return decodeURIComponent(msg.replace(/(..)/g, '%$1')) } catch { return msg } })()
      : msg
    return decoded ?? (typeof o.code === 'string' ? o.code : JSON.stringify(e))
  }
  return String(e)
}

export async function sendTronTransaction(privateKey: string, to: string, amount: string): Promise<string> {
  const tronWeb = new TronWeb({ fullHost: resolveTronFullHost() })

  const from = TronWeb.address.fromPrivateKey(privateKey)
  if (!from) throw new Error('Invalid private key')

  const amountSun = Math.round(parseFloat(amount) * 1_000_000)
  if (!Number.isFinite(amountSun) || amountSun <= 0) throw new Error('Invalid amount')

  try {
    const tx = await tronWeb.transactionBuilder.sendTrx(to, amountSun, from)
    const signedTx = await tronWeb.trx.sign(tx, privateKey)
    const result = await tronWeb.trx.sendRawTransaction(signedTx)

    if (!result?.result || !result.txid) {
      throw new Error(`Broadcast rejected: ${describeTronError(result)}`)
    }
    return result.txid
  } catch (e) {
    console.error('sendTronTransaction failed:', e)
    throw new Error(describeTronError(e))
  }
}

function tronHexToBase58(hex?: string): string | undefined {
  if (!hex) return undefined
  try {
    return TronWeb.address.fromHex(hex)
  } catch {
    return undefined
  }
}

/**
 * Transaction history straight from TronGrid's public account endpoint — no API
 * key, no backend. Native TRX transfers only (TransferContract); TRC-20 and other
 * contract calls are ignored, matching the backend's mapping.
 *
 * TronGrid returns addresses as hex, so they are converted back to base58.
 */
export async function getTronHistory(address: string, limit = MAX_HISTORY_TXS): Promise<OnChainTx[]> {
  const url = `${resolveTronFullHost()}/v1/accounts/${address}/transactions`
    + `?limit=${limit}&only_confirmed=true&order_by=block_timestamp,desc`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch TRON history: ${res.status}`)
  const body = await res.json()

  const out: OnChainTx[] = []
  for (const tx of body?.data ?? []) {
    const contract = tx.raw_data?.contract?.[0]
    if (contract?.type !== 'TransferContract') continue

    const value = contract.parameter?.value ?? {}
    const from = tronHexToBase58(value.owner_address)
    const to   = tronHexToBase58(value.to_address)
    const magnitude = Number(value.amount ?? 0) / SUN_PER_TRX

    out.push({
      txId: tx.txID,
      amount: from === address ? -magnitude : magnitude,
      currency: 'TRX',
      from,
      to,
      blockNumber: tx.blockNumber,
      timestamp: tx.block_timestamp,
    })
  }
  return out
}

/**
 * Native TRX balance from TronGrid's public account endpoint — no API key, which
 * is the point: a browser cannot hold a secret, so the read path must not need one.
 *
 * An address that has never received funds does not exist on-chain yet. TronGrid
 * answers 200 with an empty list rather than an error, and its balance is zero.
 */
export async function getTronBalance(address: string): Promise<number> {
  const res = await fetch(`${resolveTronFullHost()}/v1/accounts/${address}`)
  if (!res.ok) throw new Error(`Failed to fetch TRON balance: ${res.status}`)
  const body = await res.json()

  return Number(body?.data?.[0]?.balance ?? 0) / SUN_PER_TRX
}
