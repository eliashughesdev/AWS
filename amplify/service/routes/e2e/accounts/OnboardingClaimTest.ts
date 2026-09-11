// Phase 2, unauthenticated — no signature, no X-Project needed beyond the header
// the API already tolerates. Run AccountsOnboardingTest.ts first and paste the
// claimToken it prints.
const TOKEN = process.env.CLAIM_TOKEN ?? 'paste-the-claimToken-here'
const PASSWORD = process.env.CLAIM_PASSWORD ?? 'Sh4sta!Testing'

const base = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1'

const call = async (path: string, body: Record<string, unknown>) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  console.log(path, res.status, await res.json().catch(() => null))
}

const run = async () => {
  console.log('--- verify (does not consume the token) ---')
  await call('/onboarding/verify', { token: TOKEN })

  console.log('--- verify again (still usable) ---')
  await call('/onboarding/verify', { token: TOKEN })

  console.log('--- claim ---')
  await call('/onboarding/claim', { token: TOKEN, password: PASSWORD })

  console.log('--- claim again (expect 100036 already used) ---')
  await call('/onboarding/claim', { token: TOKEN, password: PASSWORD })

  console.log('--- verify after claim (expect 100036) ---')
  await call('/onboarding/verify', { token: TOKEN })
}

run().catch(err => console.log(err))
