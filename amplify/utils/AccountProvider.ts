import { TatumProvider } from '../providers/tatum/tatum'
import { AccountProvider } from '../providers/provider'
import {ProviderName} from '../providers/ProviderName'


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
