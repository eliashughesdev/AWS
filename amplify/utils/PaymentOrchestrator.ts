import { PaymentParams, PaymentResult, PaymentProcessorConfig } from '../providers/payment/PaymentProcessor';
import { PaymentProcessorRegistry, PaymentProviderType } from './PaymentProviders';

export interface AttemptLogEntry {
  attemptNumber: number;
  provider: string;
  result: PaymentResult;
}

export type OnAttemptCallback = (entry: AttemptLogEntry) => Promise<void>;

export class PaymentOrchestrator {
  static async processWithFailover(
    primaryProvider: PaymentProviderType,
    params: PaymentParams,
    config: PaymentProcessorConfig,
    onAttempt?: OnAttemptCallback
  ): Promise<PaymentResult> {
    const chain = PaymentProcessorRegistry.getFallbackChain(primaryProvider);
    const errors: { provider: string; error: string }[] = [];
    let attemptNumber = 0;

    for (const provider of chain) {
      attemptNumber++;
      const processor = PaymentProcessorRegistry.getProcessor(provider, config);
      if (!processor) {
        console.warn(`PaymentOrchestrator: Could not create processor for ${provider}, skipping`);
        continue;
      }

      console.log(`PaymentOrchestrator: Attempting payment with ${provider}`);
      const result = await processor.processPayment(params);

      if (onAttempt) {
        try {
          await onAttempt({ attemptNumber, provider, result });
        } catch (logError) {
          console.error('PaymentOrchestrator: Logging callback failed:', logError);
        }
      }

      if (result.success || !result.retryable) {
        return { ...result, metadata: { ...result.metadata, provider, attempts: attemptNumber } };
      }

      console.warn(`PaymentOrchestrator: ${provider} failed with retryable error: ${result.error}`);
      errors.push({ provider, error: result.error || 'Unknown error' });
    }

    return {
      success: false,
      error: 'All payment processors failed',
      status: 'failed',
      retryable: false,
      metadata: { attempts: attemptNumber, errors },
    };
  }
}
