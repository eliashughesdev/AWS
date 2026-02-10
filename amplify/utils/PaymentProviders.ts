import { PaymentProcessor, PaymentProcessorConfig } from '../providers/payment/PaymentProcessor';
import { StripePaymentProcessor } from '../providers/payment/StripePaymentProcessor';
import { CloverPaymentProcessor } from '../providers/payment/CloverPaymentProcessor';

export type PaymentProviderType = 'stripe' | 'clover';

interface ProcessorClass {
  create(config: PaymentProcessorConfig): PaymentProcessor;
}

export class PaymentProcessorRegistry {
  private static processors: Record<PaymentProviderType, ProcessorClass> = {
    stripe: StripePaymentProcessor,
    clover: CloverPaymentProcessor,
  };

  private static fallbackChains: Record<PaymentProviderType, PaymentProviderType[]> = {
    stripe: ['stripe', 'clover'],
    clover: ['clover', 'stripe'],
  };

  static getProcessor(provider: PaymentProviderType, config: PaymentProcessorConfig): PaymentProcessor | null {
    const processorClass = this.processors[provider];

    if (!processorClass) {
      return null;
    }

    try {
      return processorClass.create(config);
    } catch (error: any) {
      console.error(`Failed to create processor for ${provider}:`, error.message);
      return null;
    }
  }

  static getFallbackChain(primaryProvider: PaymentProviderType): PaymentProviderType[] {
    return this.fallbackChains[primaryProvider] || [primaryProvider];
  }
}