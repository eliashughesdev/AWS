// Minimal ambient types for tronweb v5 (the package ships no .d.ts).
// Covers only the surface used in src/wallet/tron.ts.
declare module 'tronweb' {
  interface TronWebOptions {
    fullHost: string
    privateKey?: string
  }

  interface BroadcastResult {
    result?: boolean
    txid?: string
    code?: string
    message?: string
    transaction?: unknown
  }

  class TronWeb {
    constructor(options: TronWebOptions)
    static address: { fromPrivateKey(privateKey: string): string | false }
    transactionBuilder: {
      sendTrx(to: string, amount: number, from: string): Promise<unknown>
    }
    trx: {
      sign(transaction: unknown, privateKey: string): Promise<unknown>
      sendRawTransaction(signedTransaction: unknown): Promise<BroadcastResult>
    }
  }

  export default TronWeb
}
