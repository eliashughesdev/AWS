import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import type { EmailProvider } from '../EmailProvider'

export class SesEmailProvider implements EmailProvider {
  private ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' })

  async sendEmail(to: string, subject: string, body: string) {
    await this.ses.send(new SendEmailCommand({
      Source: process.env.SES_FROM_EMAIL!,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject },
        Body: { Text: { Data: body } }
      }
    }))
  }
}
