export type ResourceType = 'ENERGY' | 'BANDWIDTH'

export interface RentRequest {
  resource: ResourceType
  receiver: string
  // Already includes the margin and the provider's minimum
  amount: number
}

// 'placed': an order exists and was paid for; delivery is pending.
// 'refused': nothing was bought, so trying the next provider is safe.
// A throw means the provider can't tell whether an order exists: don't try another.
export type RentOutcome =
  | { status: 'placed', orderId: string }
  | { status: 'refused', reason: string }

export interface EnergyProvider {
  readonly name: string
  readonly resources: ResourceType[]
  // 0 when none is known
  minimum(resource: ResourceType): number
  rent(request: RentRequest): Promise<RentOutcome>
}
