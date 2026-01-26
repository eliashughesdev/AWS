import { TatumProvider } from '../providers/ledger/tatum/tatum'
import { AccountProvider } from '../providers/ledger/provider'
import {ProviderName} from '../providers/ledger/ProviderName'


const providerMap: Record<ProviderName, () => AccountProvider> = {
    [ProviderName.Tatum]: () => new TatumProvider()
}

export class ProviderRegistry {
  static getProvider(name: ProviderName): AccountProvider {
    const factory = providerMap[name]
    if (!factory) throw new Error(`Unknown provider: ${name}`)
    return factory()
  }
}
