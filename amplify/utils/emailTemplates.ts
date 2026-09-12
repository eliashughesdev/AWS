export interface Email {
  subject: string
  text: string
  html: string
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/**
 * Invite for a payer onboarded by a merchant platform. firstName comes from the
 * merchant and is escaped — left raw, a caller could plant a link in an email sent
 * from our own domain.
 */
export const claimInviteEmail = ({ brand, firstName, link, expiresAt }: {
  brand: string
  firstName?: string | null
  link: string
  expiresAt: number
}): Email => {
  const days = Math.max(1, Math.round((expiresAt - Date.now()) / 86_400_000))
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,'
  const b = escapeHtml(brand)
  const href = escapeHtml(link)

  return {
    subject: `Your ${brand} account is ready`,
    text: [
      greeting,
      '',
      `A ${brand} account was created for you after your recent payment. Choose a password to sign in:`,
      '',
      link,
      '',
      `This link works once and expires in ${days} days.`,
      '',
      'If you did not expect this email, you can ignore it — nothing happens until a password is set.',
    ].join('\n'),
    html: [
      '<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">',
      `<h2 style="margin: 0 0 16px;">Welcome to ${b}</h2>`,
      `<p>${escapeHtml(greeting)}</p>`,
      `<p>A ${b} account was created for you after your recent payment. Choose a password to sign in.</p>`,
      `<p style="margin: 16px 0 24px;"><a href="${href}" style="display: inline-block; padding: 12px 24px; background-color: #1a1a1a; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; border: 2px solid #3d3d3d;">Set your password</a></p>`,
      `<p style="color: #666; font-size: 13px;">This link works once and expires in ${days} days. If the button does not work, paste this address into your browser:<br><span style="word-break: break-all;">${href}</span></p>`,
      '<p style="color: #666; font-size: 12px;">If you did not expect this email, you can ignore it — nothing happens until a password is set.</p>',
      '</div>',
    ].join(''),
  }
}
