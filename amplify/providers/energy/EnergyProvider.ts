export type ResourceType = 'ENERGY' | 'BANDWIDTH'

export interface RentRequest {
  resource: ResourceType
  receiver: string
  // Already includes the margin and the provider's minimum
  amount: number
  // Only when the receiver was never activated: the provider activates it, and
  // calls this with what that cost as soon as it is paid for, whatever happens
  // to the order after
  onActivated?: (sun: number) => Promise<void>
}

// 'placed': an order exists and was paid for; delivery is pending.
// 'refused': the provider will deliver nothing, so trying the next one is safe.
// A throw means the provider can't tell whether an order exists: don't try another.
export type RentOutcome =
  | { status: 'placed', orderId: string, costSun?: number }
  | { status: 'refused', reason: string }

// What a provider says about a placed order while it is awaited on chain.
// 'failed': it will never deliver, so trying the next provider is safe.
export type OrderState = { status: 'pending' } | { status: 'failed', reason: string }

// An address's activation, paid to a provider in sun
export interface Activation {
  provider: string
  sun: number
}

export interface EnergyProvider {
  // Also its name in TRON_ENERGY_PROVIDERS, in any case
  readonly name: string
  readonly resources: ResourceType[]
  // How long a placed order may take to show on chain
  readonly deliveryTimeoutMs: number
  // What activating an address costs, as the provider publishes it
  readonly activationSun: number
  // 0 when none is known
  minimum(resource: ResourceType): number
  rent(request: RentRequest): Promise<RentOutcome>
  // Lets the wait end early when an order failed. Without it, only the chain is read.
  orderState?(orderId: string): Promise<OrderState>
}
