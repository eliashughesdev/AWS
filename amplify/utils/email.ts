import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' })

export async function sendWelcomeEmail(toEmail: string, accountNo: string) {
  await ses.send(new SendEmailCommand({
    Source: process.env.SES_FROM_EMAIL!,
    Destination: { ToAddresses: [toEmail] },
    Message: {
      Subject: { Data: 'Welcome to Loudibly — your account is ready' },
      Body: {
        Text: {
          Data: `Your account has been created.\nAccount number: ${accountNo}\n\nWelcome aboard!`
        }
      }
    }
  }))
}
