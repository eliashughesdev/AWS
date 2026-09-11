import type { CustomMessageTriggerHandler } from 'aws-lambda'
import { brandName, loadConfig } from '../../utils/config'

export const handler: CustomMessageTriggerHandler = async (event) => {
  if (
    event.triggerSource === 'CustomMessage_SignUp' ||
    event.triggerSource === 'CustomMessage_ResendCode'
  ) {
    await loadConfig()
    const brand = brandName()
    // From SSM. Without it the email ships code-only, with no one-click link.
    const frontendUrl = process.env.FRONTEND_URL

    const email = event.request.userAttributes.email ?? ''
    // codeParameter is the literal placeholder "{####}" — Cognito substitutes the
    // real code everywhere it appears in the message, including inside the link URL
    const code = event.request.codeParameter

    const linkBlock = frontendUrl
      ? [
          '<p>Enter it in the app, or confirm your email with one click:</p>',
          `<p style="margin: 16px 0 24px;"><a href="${frontendUrl}/v2/confirm?email=${encodeURIComponent(email)}&code=${code}" style="display: inline-block; padding: 12px 24px; background-color: #1a1a1a; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; border: 2px solid #3d3d3d;">Confirm my email</a></p>`,
        ]
      : ['<p>Enter it in the app to confirm your email.</p>']

    event.response.emailSubject = `Confirm your ${brand} account`
    event.response.emailMessage = [
      '<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">',
      `<h2 style="margin: 0 0 16px;">Welcome to ${brand}</h2>`,
      '<p>Your confirmation code is:</p>',
      `<p style="font-size: 28px; font-weight: bold; letter-spacing: 6px; margin: 8px 0 24px;">${code}</p>`,
      ...linkBlock,
      `<p style="color: #666; font-size: 12px;">If you did not create a ${brand} account, you can safely ignore this email.</p>`,
      '</div>',
    ].join('')
  }
  return event
}
