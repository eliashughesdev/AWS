import { TatumSDK, Network, Status, type Tron } from '@tatumio/tatum'
import { TronWalletProvider } from '@tatumio/tron-wallet-provider'

// Must match the network the backend/Tatum subscriptions run on. Defaults to
// TRON testnet (Shasta = "tron-testnet"); set VITE_TRON_NETWORK=mainnet for production.
function resolveTronNetwork(): Network {
  return import.meta.env.VITE_TRON_NETWORK === 'mainnet' ? Network.TRON : Network.TRON_SHASTA
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

export async function sendTronTransaction(privateKey: string, to: string, amount: string): Promise<string> {
  const tatum = await getTatum()
  return tatum.walletProvider.use(TronWalletProvider).signAndBroadcast({ privateKey, to, amount })
}

export interface TronTokenBalance {
  asset: string        // currency/token symbol, e.g. 'TRX' or 'USDT'
  balance: string      // balance as returned by Tatum
  decimals?: number
  type: string         // 'native' | 'fungible' | ...
  tokenAddress?: string
}

export interface TronAccountDetails {
  address: string
  native: TronTokenBalance | null   // the TRX balance, pulled out for convenience
  tokens: TronTokenBalance[]        // TRC-20 / other token balances
  raw: TronTokenBalance[]           // full, unmodified balance list from Tatum
}

/**
 * Fetches on-chain details (TRX + token balances) for a TRON address using the
 * Tatum SDK. Works for non-custodial accounts since they are just plain TRON
 * addresses.
 *
 * Note: this hits Tatum's Data API. With no TATUM_API_KEY configured the call
 * may be rate-limited or rejected — pass an apiKey to TatumSDK.init for
 * reliable access.
 */
export async function getTronAccountDetails(address: string): Promise<TronAccountDetails> {
  const tatum = await getTatum()
  try {
    const res = await tatum.address.getBalance({ address })

    if (res.status !== Status.SUCCESS || !res.data) {
      const message = res.error?.message?.toString() ?? 'Unknown error'
      throw new Error(`Failed to fetch TRON account details: ${message}`)
    }

    const balances = res.data as TronTokenBalance[]
    return {
      address,
      native: balances.find(b => b.type === 'native') ?? null,
      tokens: balances.filter(b => b.type !== 'native'),
      raw: balances,
    }
  } finally {
    // Release the SDK's internal container/connections for this instance.
    await tatum.destroy()
  }
}
