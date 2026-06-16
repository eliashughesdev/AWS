import type { CustomMessageTriggerHandler } from 'aws-lambda'
import { loadConfig } from '../../utils/config'

export const handler: CustomMessageTriggerHandler = async (event) => {
  if (
    event.triggerSource === 'CustomMessage_SignUp' ||
    event.triggerSource === 'CustomMessage_ResendCode'
  ) {
    await loadConfig()
    const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://my.staging.loudibly.com'

    const email = event.request.userAttributes.email ?? ''
    // codeParameter is the literal placeholder "{####}" — Cognito substitutes the
    // real code everywhere it appears in the message, including inside the link URL
    const code = event.request.codeParameter
    const link = `${FRONTEND_URL}/v2/confirm?email=${encodeURIComponent(email)}&code=${code}`

    event.response.emailSubject = 'Confirm your Loudibly account'
    event.response.emailMessage = [
      '<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">',
      '<h2 style="margin: 0 0 16px;">Welcome to Loudibly</h2>',
      '<p>Your confirmation code is:</p>',
      `<p style="font-size: 28px; font-weight: bold; letter-spacing: 6px; margin: 8px 0 24px;">${code}</p>`,
      '<p>Enter it in the app, or confirm your email with one click:</p>',
      `<p style="margin: 16px 0 24px;"><a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #1a1a1a; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; border: 2px solid #3d3d3d;">Confirm my email</a></p>`,
      '<p style="color: #666; font-size: 12px;">If you did not create a Loudibly account, you can safely ignore this email.</p>',
      '</div>',
    ].join('')
  }
  return event
}
