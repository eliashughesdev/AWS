// What a log may say about an API request. Never a body value or a header: those carry passwords
// and one-time tokens (/onboarding/claim), card data, addresses, JWTs and HMAC signatures, and
// CloudWatch keeps whatever is logged.
export const describeRequest = (event: any) => ({
  method: event?.httpMethod,
  path: event?.path,
  requestId: event?.requestContext?.requestId,
  role: event?.requestContext?.authorizer?.role,
})

// The body's field names, never their values
export const bodyFields = (body: unknown): string[] | string =>
  body !== null && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : typeof body
