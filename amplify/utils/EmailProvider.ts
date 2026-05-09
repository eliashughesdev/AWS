import type { EmailProvider } from '../providers/email/EmailProvider'
import { SesEmailProvider } from '../providers/email/ses/SesEmailProvider'

const emailProviderMap: Record<string, () => EmailProvider> = {
  'AWS_SIMPLE_EMAIL_SERVICE': () => new SesEmailProvider(),
}

export function getEmailProvider(): EmailProvider {
  const name = process.env.EMAIL_PROVIDER ?? 'AWS_SIMPLE_EMAIL_SERVICE'
  const factory = emailProviderMap[name]
  if (!factory) throw new Error(`Unknown email provider: ${name}`)
  return factory()
}
