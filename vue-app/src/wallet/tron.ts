import { TatumSDK, Network, type Tron } from '@tatumio/tatum'
import { TronWalletProvider } from '@tatumio/tron-wallet-provider'

async function getTatum() {
  return TatumSDK.init<Tron>({
    network: Network.TRON,
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
