import { PaymentProcessor, PaymentProcessorConfig } from '../providers/payment/PaymentProcessor';
import { StripePaymentProcessor } from '../providers/payment/StripePaymentProcessor';
// import { CloverPaymentProcessor } from '../providers/payment/CloverPaymentProcessor'';

export type PaymentProviderType = 'stripe' | 'clover';

type ProcessorRegistry = {
  create: (config: PaymentProcessorConfig) => PaymentProcessor;
};

export class PaymentProcessorRegistry {
  private static processors: Map<PaymentProviderType, ProcessorRegistry> = new Map([
    ['stripe', StripePaymentProcessor],
    // ['clover', CloverPaymentProcessor],
  ]);

  static getProcessor(provider: PaymentProviderType, config: PaymentProcessorConfig): PaymentProcessor | null {
    const processorClass = this.processors.get(provider);

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
}