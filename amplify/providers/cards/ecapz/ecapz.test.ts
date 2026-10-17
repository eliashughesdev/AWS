import { EcapzCardIssuer, sign, webhookSignature } from './ecapz'

const fetchMock = jest.spyOn(global, 'fetch')
const answer = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }) as Response
const ok = (data: unknown) => answer(200, { success: true, res: { data } })
const refusal = (code: number, message = 'refused') => answer(400, { error_code: code, message })

// Made up, never the lab's
const SECRET = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const WEBHOOK_SECRET = 'test-webhook-secret-0123456789'
const config = {
  ECAPZ_URL: 'https://ecapz.test/',
  ECAPZ_PROJECT: 'project-1',
  ECAPZ_SECRET: SECRET,
  ECAPZ_WEBHOOK_SECRET: WEBHOOK_SECRET,
  ECAPZ_WEBHOOK_URL: 'https://api.test/webhook/cards/ecapz',
}

const sent = () => fetchMock.mock.calls.map(([url, init]) => ({
  url: String(url),
  method: init?.method,
  headers: init?.headers as Record<string, string>,
  body: JSON.parse(String(init?.body)),
  rawBody: String(init?.body),
}))

const issuer = new EcapzCardIssuer()

beforeEach(() => {
  fetchMock.mockReset()
  Object.assign(process.env, config)
})

// /v2/cards/details as the live API answered it on 2026-10-16 (ids and owner made up)
const liveCard = {
  card_id: 'card-1',
  name: 'Card test',
  available_balance: '0.000000000',
  spent_balance: '0.000000000',
  currency: 'USD',
  holder: null,
  card_tokenization: [],
  masked_number: '4579',
  payment_system: 'mastercard',
  card_type: 'virtual',
  expired_at: '10.2028',
  limits: [],
  card_owner: { owner_id: 'owner-1', first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com', phone_number: '15550000000' },
  status: 'active',
  available_actions: ['close', 'freeze'],
  created_at: '2026-10-16T01:48:54+00:00',
  updated_at: '2026-10-16T01:49:07+00:00',
  deleted_at: null,
}

describe('sign', () => {
  // Worked out with the lab's pipeline:
  //   printf '%s' "$BODY" | openssl dgst -sha256 -r
  //   printf '%s' "$PATH$TS$BODY_HASH" | openssl dgst -sha256 -mac HMAC -macopt hexkey:$SECRET -binary | openssl base64 -A
  it('signs path + timestamp + the body hash with the hex-decoded secret', () => {
    expect(sign(SECRET, '/v2/cards/details', '1767225600000', '{"company_id":"cmp_test","card_id":"card_test"}')).toBe(
      'Signature 1767225600000:c66b41fad7be52f9e52a69d2370dac2f16a7365bb5da6630b679ca039a19093c:Wk0hdCkFm5uuWAf4OBHKDf3RhvFLZBbmOukwLq2VgVg=')
  })
})

describe('requests', () => {
  it('sends a signed POST of the JSON body to the path', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'cmp-1', name: 'NodaMoney', status: 'active' }))
    await issuer.getCompany('cmp-1')

    const [request] = sent()
    expect(request.url).toBe('https://ecapz.test/v2/companies/get-company')
    expect(request.method).toBe('POST')
    expect(request.body).toEqual({ company_id: 'cmp-1' })
    const { Authorization: authorization, ...rest } = request.headers
    expect(rest).toEqual({ 'Content-Type': 'application/json', 'X-Project': 'project-1' })
    const timestamp = authorization.split(' ')[1].split(':')[0]
    expect(Math.abs(Date.now() - Number(timestamp))).toBeLessThan(5_000)
    expect(authorization).toBe(sign(SECRET, '/v2/companies/get-company', timestamp, request.rawBody))
  })

  it.each([
    [{ ECAPZ_URL: '' }, 'ECAPZ_URL is not set'],
    [{ ECAPZ_SECRET: '' }, 'ECAPZ_SECRET is not set'],
    [{ ECAPZ_SECRET: 'not-hex' }, 'ECAPZ_SECRET is not hex'],
  ])('refuses without sending anything when a setting is missing or wrong (%o)', async (settings, logged) => {
    Object.assign(process.env, settings)
    const error = jest.spyOn(console, 'error')
    expect(await issuer.getCompany('cmp-1')).toEqual({ status: 'refused', reason: 'ecapz is not configured' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(`CONFIG_ERROR (EcapzCardIssuer): ${logged}`)
  })
})

describe('outcomes', () => {
  it('is done on a 200 that has no `success` field', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { res: { data: { id: 'cmp-1', status: 'active' } } }))
    expect(await issuer.getCompany('cmp-1')).toEqual({ status: 'done', value: { id: 'cmp-1', name: undefined, active: true } })
  })

  it('is refused with the issuer\'s code on a 400', async () => {
    fetchMock.mockResolvedValueOnce(refusal(100002, 'this account id is not configured properly'))
    expect(await issuer.issueCard('cmp-1', { cardholderId: 'o', cardAccountId: 'a', binId: 'b', name: 'n' })).toEqual({
      status: 'refused', code: 100002, reason: '/v2/cards/card -> 400: 100002 this account id is not configured properly',
    })
  })

  it('is refused on an error code even with a 200', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { error_code: 100062, message: 'not enough balance' }))
    expect(await issuer.load('cmp-1', 'acc-1', '10.00')).toMatchObject({ status: 'refused', code: 100062 })
  })

  it('is refused on a 403, the answer to a bad signature', async () => {
    fetchMock.mockResolvedValueOnce(answer(403, 'Forbidden'))
    expect(await issuer.getCompany('cmp-1')).toEqual({ status: 'refused', reason: '/v2/companies/get-company -> 403: signature refused' })
  })

  it.each([
    ['no answer', () => fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))],
    ['a timeout', () => fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))],
    ['a 500', () => fetchMock.mockResolvedValueOnce(answer(500, { error_code: 100040, message: 'General failure' }))],
    ['a 502 page', () => fetchMock.mockResolvedValueOnce(answer(502, '<html>Bad Gateway</html>'))],
    ['a 200 that is not JSON', () => fetchMock.mockResolvedValueOnce(answer(200, 'OK'))],
    ['a 200 without the new id', () => fetchMock.mockResolvedValueOnce(ok({}))],
  ])('is unknown on %s, so a card may have been issued', async (_, reply) => {
    reply()
    const result = await issuer.issueCard('cmp-1', { cardholderId: 'o', cardAccountId: 'a', binId: 'b', name: 'n' })
    expect(result).toMatchObject({ status: 'unknown' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('company', () => {
  it('sets the environment\'s webhook secret', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, {}))
    expect(await issuer.setWebhookSecret('cmp-1')).toEqual({ status: 'done', value: undefined })
    expect(sent()[0]).toMatchObject({ url: 'https://ecapz.test/v2/companies/update-company', body: { company_id: 'cmp-1', webhook_secret: WEBHOOK_SECRET } })
  })

  it('reads the corporate balance, which comes without a currency', async () => {
    fetchMock.mockResolvedValueOnce(ok({ company_id: 'cmp-1', available_balance: '0.00' }))
    expect(await issuer.corporateBalance('cmp-1')).toEqual({ status: 'done', value: { available: '0.00', currency: undefined } })
  })
})

describe('cardholders and card accounts', () => {
  const holder = { firstName: 'Ann', lastName: 'Lee', email: 'ann@example.com', phone: '+15550000000', reference: 'user-1' }

  it('creates a cardholder with our reference', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'owner-1' }))
    expect(await issuer.createCardholder('cmp-1', holder)).toEqual({ status: 'done', value: 'owner-1' })
    expect(sent()[0].body).toEqual({
      company_id: 'cmp-1', first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com', phone_number: '+15550000000', external_id: 'user-1',
    })
  })

  it('finds a cardholder by our reference, skipping removed ones', async () => {
    fetchMock.mockResolvedValue(ok([
      { id: 'owner-0', external_id: 'user-1', status: 'inactive' },
      { id: 'owner-2', external_id: 'user-2', status: 'active' },
      { id: 'owner-1', external_id: 'user-1', status: 'active' },
    ]))
    expect(await issuer.findCardholder('cmp-1', 'user-1')).toEqual({ status: 'done', value: 'owner-1' })
    expect(await issuer.findCardholder('cmp-1', 'user-9')).toEqual({ status: 'done', value: null })
  })

  it('creates a card account named by our reference, its events sent to our webhook', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'acc-1' }))
    expect(await issuer.createCardAccount('cmp-1', 'user-1')).toEqual({ status: 'done', value: 'acc-1' })
    expect(sent()[0].body).toEqual({ company_id: 'cmp-1', account_name: 'user-1', webhook_url: 'https://api.test/webhook/cards/ecapz' })
  })

  it('refuses to create a card account without a webhook address', async () => {
    process.env.ECAPZ_WEBHOOK_URL = ''
    expect(await issuer.createCardAccount('cmp-1', 'user-1')).toEqual({ status: 'refused', reason: 'ECAPZ_WEBHOOK_URL is not set' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('finds an active card account by its name', async () => {
    fetchMock.mockResolvedValueOnce(ok([
      { id: 'acc-0', name: 'user-1', status: 'inactive' },
      { id: 'acc-1', name: 'user-1', status: 'active', webhook_url: 'https://api.test/webhook/cards/ecapz' },
    ]))
    expect(await issuer.findCardAccount('cmp-1', 'user-1')).toEqual({ status: 'done', value: 'acc-1' })
  })

  it('reads a card account\'s balance', async () => {
    fetchMock.mockResolvedValueOnce(ok({ account_id: 'acc-1', available_balance: '12.50', currency: 'USD' }))
    expect(await issuer.cardAccountBalance('cmp-1', 'acc-1')).toEqual({ status: 'done', value: { available: '12.50', currency: 'USD' } })
  })
})

describe('load and unload', () => {
  it.each([
    ['load', '/v2/accounts/deposit'],
    ['unload', '/v2/accounts/withdraw'],
  ] as const)('%s moves the amount through %s', async (method, path) => {
    fetchMock.mockResolvedValueOnce(ok({ amount: '10.50', currency: 'USD' }))
    expect(await issuer[method]('cmp-1', 'acc-1', '10.50')).toEqual({ status: 'done', value: undefined })
    expect(sent()[0]).toMatchObject({ url: `https://ecapz.test${path}`, body: { company_id: 'cmp-1', account_id: 'acc-1', amount: '10.50' } })
  })

  it.each(['0', '0.00', '-1', '1.234', '1e3', '', '.5'])('refuses %p without sending it', async (amount) => {
    expect(await issuer.load('cmp-1', 'acc-1', amount)).toMatchObject({ status: 'refused' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('cards', () => {
  it('issues a virtual card on the card account', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'card-1' }))
    expect(await issuer.issueCard('cmp-1', { cardholderId: 'owner-1', cardAccountId: 'acc-1', binId: 'bin-1', name: 'My card' }))
      .toEqual({ status: 'done', value: 'card-1' })
    expect(sent()[0].body).toEqual({ company_id: 'cmp-1', card_bin_id: 'bin-1', account_id: 'acc-1', owner_id: 'owner-1', name: 'My card', card_type: 'virtual' })
  })

  it('reads a card as the live API answers it', async () => {
    fetchMock.mockResolvedValueOnce(ok(liveCard))
    expect(await issuer.cardDetails('cmp-1', 'card-1')).toEqual({
      status: 'done',
      value: {
        id: 'card-1',
        cardAccountId: undefined,
        cardholderId: 'owner-1',
        name: 'Card test',
        last4: '4579',
        network: 'mastercard',
        type: 'virtual',
        status: 'active',
        expiry: { month: 10, year: 2028 },
      },
    })
  })

  it('reads a card as the spec writes it', async () => {
    fetchMock.mockResolvedValueOnce(ok({ ...liveCard, masked_number: '**** **** **** 4421', payment_system: 'VISA', expired_at: '2029-05-31T00:00:00Z', status: 'frozen' }))
    expect(await issuer.cardDetails('cmp-1', 'card-1')).toMatchObject({
      status: 'done', value: { last4: '4421', network: 'visa', status: 'frozen', expiry: { month: 5, year: 2029 } },
    })
  })

  it('says a card is not ready on 100016', async () => {
    fetchMock.mockResolvedValueOnce(refusal(100016, 'failed to get details for this card id'))
    expect(await issuer.cardDetails('cmp-1', 'card-1')).toEqual({ status: 'not-ready' })
  })

  it('lists a card account\'s cards from `data.cards`, a pending one without its number', async () => {
    fetchMock.mockResolvedValueOnce(ok({ cards: [{ ...liveCard, account_id: 'acc-1' }, { card_id: 'card-2', status: 'pending', masked_number: null }] }))
    const result = await issuer.listCards('cmp-1', 'acc-1')
    expect(sent()[0].body).toEqual({ company_id: 'cmp-1', account_id: 'acc-1' })
    expect(result).toMatchObject({ status: 'done', value: [{ id: 'card-1', cardAccountId: 'acc-1', last4: '4579' }, { id: 'card-2', status: 'pending', last4: undefined }] })
  })

  it('is unknown when a listed card has no id, rather than leave it out', async () => {
    fetchMock.mockResolvedValueOnce(ok({ cards: [liveCard, { status: 'active' }] }))
    expect(await issuer.listCards('cmp-1', 'acc-1')).toMatchObject({ status: 'unknown' })
  })

  it.each([
    ['freeze', '/v2/cards/freeze'],
    ['unfreeze', '/v2/cards/unfreeze'],
    ['block', '/v2/cards/block'],
  ] as const)('%s calls %s', async (action, path) => {
    fetchMock.mockResolvedValueOnce(ok({ message: 'request received' }))
    expect(await issuer.changeCard('cmp-1', 'card-1', action)).toEqual({ status: 'done', value: undefined })
    expect(sent()[0]).toMatchObject({ url: `https://ecapz.test${path}`, body: { company_id: 'cmp-1', card_id: 'card-1' } })
  })

  const row = {
    id: 'tx-1',
    account_id: 'acc-1',
    card_id: 'card-1',
    amount: '42.50',
    currency: 'USD',
    fee_amount: '0.00',
    fee_currency: 'USD',
    settlement_amount: '42.50',
    settlement_currency: 'USD',
    transaction_type: 'card-purchase',
    status: 'completed',
    created_at: '2026-05-13T14:22:08Z',
  }
  const payment = {
    id: 'tx-1',
    cardId: 'card-1',
    cardAccountId: 'acc-1',
    type: 'card-purchase',
    status: 'completed',
    amount: { amount: '42.50', currency: 'USD' },
    settled: { amount: '42.50', currency: 'USD' },
    fee: { amount: '0.00', currency: 'USD' },
    at: '2026-05-13T14:22:08Z',
  }

  it.each([
    ['inside `data.transactions`, as live', { transactions: [row] }],
    ['as `data`, as the spec writes', [row]],
  ])('lists a card\'s payments %s', async (_, data) => {
    fetchMock.mockResolvedValueOnce(ok(data))
    expect(await issuer.cardPayments('cmp-1', 'card-1')).toMatchObject({ status: 'done', value: [payment] })
  })

  it('reads the reveal page', async () => {
    fetchMock.mockResolvedValueOnce(ok({ card_id: 'card-1', widget_url: 'https://reveal.test/w', widget_token: 'tok', expires_in: 300 }))
    expect(await issuer.revealCard('cmp-1', 'card-1')).toEqual({ status: 'done', value: { url: 'https://reveal.test/w', token: 'tok', expiresInSeconds: 300 } })
  })

  it('is refused where the card\'s channel has no reveal page (step 0)', async () => {
    fetchMock.mockResolvedValueOnce(refusal(100108, 'not implemented for this channel'))
    expect(await issuer.revealCard('cmp-1', 'card-1')).toMatchObject({ status: 'refused', code: 100108 })
  })
})

describe('verifyWebhook', () => {
  const raw = '{"type":"webhook","card_id":"card_test","account_id":"acc_test","company_id":"cmp_test","status":"frozen"}'
  const t = 1767225600
  const now = t * 1000 + 30_000
  // printf '%s' "$t.$raw" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET"
  const v1 = 'eb5e7e1ad2248186284860b29d13cc35819954b7c12f0f267aaaac54720ba37f'

  it('matches the vector worked out with openssl', () => {
    expect(webhookSignature(WEBHOOK_SECRET, String(t), raw)).toBe(v1)
  })

  it('accepts a delivery signed with the environment\'s secret', () => {
    expect(issuer.verifyWebhook(raw, `t=${t},v1=${v1}`, now)).toBe(true)
    expect(issuer.verifyWebhook(raw, `t=${t}, v1=0000, v1=${v1}`, now)).toBe(true)
  })

  it.each([
    ['another body', raw.replace('frozen', 'active'), `t=${t},v1=${v1}`, now],
    ['another t', raw, `t=${t + 1},v1=${v1}`, now],
    ['a t over 5 minutes old', raw, `t=${t},v1=${v1}`, t * 1000 + 301_000],
    ['a t over 5 minutes ahead', raw, `t=${t},v1=${v1}`, t * 1000 - 301_000],
    ['a wrong signature', raw, `t=${t},v1=${'0'.repeat(64)}`, now],
    ['a short signature', raw, `t=${t},v1=abc`, now],
    ['no v1', raw, `t=${t}`, now],
    ['no t', raw, `v1=${v1}`, now],
    ['no header', raw, undefined, now],
    ['no raw body', undefined, `t=${t},v1=${v1}`, now],
  ])('refuses %s', (_, body, header, at) => {
    expect(issuer.verifyWebhook(body, header, at)).toBe(false)
  })

  it('refuses everything when the secret is not set', () => {
    process.env.ECAPZ_WEBHOOK_SECRET = ''
    const error = jest.spyOn(console, 'error')
    expect(issuer.verifyWebhook(raw, `t=${t},v1=${v1}`, now)).toBe(false)
    expect(error).toHaveBeenCalledWith('CONFIG_ERROR (EcapzCardIssuer): ECAPZ_WEBHOOK_SECRET is not set')
  })
})

// The spec's example of each kind (api_2.3.0.yaml, "Webhook payloads")
describe('parseWebhook', () => {
  it('reads a card transaction', () => {
    expect(issuer.parseWebhook({
      type: 'webhook',
      id: 'tx-1',
      account_id: 'acc-1',
      company_id: 'cmp-1',
      amount: '-46.80',
      currency: 'EUR',
      fee_amount: null,
      fee_currency: null,
      settlement_amount: '57.02',
      settlement_currency: 'USD',
      status: 'declined',
      created_at: '2026-02-07T03:00:53+00:00',
      updated_at: '2026-02-07T03:00:53+00:00',
      transaction: {
        card_id: 'card-1',
        card_last4: '0598',
        merchant_name: 'HETZNER ONLINE GMBH',
        merchant_country: 'DE',
        transaction_type: 'purchase',
        rrn: null,
        authorization_code: null,
        authorized_by: 'provider',
        decline_reason: 'INSUFFICIENT_BALANCE',
        mcc: '4816',
        transaction_at: '2026-02-07T03:00:50+00:00',
      },
    })).toEqual({
      kind: 'payment',
      companyId: 'cmp-1',
      payment: {
        id: 'tx-1',
        cardId: 'card-1',
        cardAccountId: 'acc-1',
        last4: '0598',
        type: 'purchase',
        status: 'declined',
        amount: { amount: '-46.80', currency: 'EUR' },
        settled: { amount: '57.02', currency: 'USD' },
        fee: undefined,
        merchant: { name: 'HETZNER ONLINE GMBH', country: 'DE', mcc: '4816' },
        declineReason: 'INSUFFICIENT_BALANCE',
        at: '2026-02-07T03:00:50+00:00',
      },
    })
  })

  it.each([
    ['active', 'active'], ['creating', 'pending'], ['creating_failed', 'failed'], ['frozen', 'frozen'],
    ['expired', 'expired'], ['blocked', 'blocked'], ['closed', 'unknown'],
  ])('reads a card state %s as %s', (status, ours) => {
    expect(issuer.parseWebhook({ type: 'webhook', card_id: 'card-1', account_id: 'acc-1', company_id: 'cmp-1', status }))
      .toEqual({ kind: 'card-state', companyId: 'cmp-1', cardId: 'card-1', cardAccountId: 'acc-1', status: ours })
  })

  it.each([
    ['created', 'waiting'], ['in_progress', 'processing'], ['transfering', 'processing'],
    ['completed', 'completed'], ['refunded', 'refunded'], ['failed', 'failed'],
  ])('reads a top-up %s as %s', (status, ours) => {
    expect(issuer.parseWebhook({
      type: 'webhook',
      id: 'tu-1',
      account_id: 'acc-1',
      company_id: 'cmp-1',
      payment_address: '0x5d22',
      currency: 'USDTERC20',
      amount: '150',
      fee_currency: 'USDTERC20',
      fee_amount: '3',
      settlement_currency: 'USDTERC20',
      settlement_amount: '147',
      hash: '0xae3e',
      status,
    })).toEqual({
      kind: 'top-up',
      companyId: 'cmp-1',
      id: 'tu-1',
      status: ours,
      address: '0x5d22',
      currency: 'USDTERC20',
      amount: '150',
      fee: { amount: '3', currency: 'USDTERC20' },
      credited: { amount: '147', currency: 'USDTERC20' },
      txHash: '0xae3e',
    })
  })

  it('reads a balance movement, its kind possibly empty', () => {
    const movement = {
      type: 'webhook',
      id: 'mv-1',
      account_id: 'acc-1',
      company_id: 'cmp-1',
      amount: '1000.00',
      currency: 'USD',
      fee_amount: '0.00',
      fee_currency: 'USD',
      settlement_amount: '1000.00',
      settlement_currency: 'USD',
      status: 'completed',
      created_at: '2026-02-07T03:00:53.000Z',
      updated_at: '2026-02-07T03:00:53.000Z',
      transaction_type: 'account-deposit',
    }
    expect(issuer.parseWebhook(movement)).toEqual({
      kind: 'balance-movement',
      companyId: 'cmp-1',
      id: 'mv-1',
      cardAccountId: 'acc-1',
      type: 'account-deposit',
      amount: { amount: '1000.00', currency: 'USD' },
      fee: { amount: '0.00', currency: 'USD' },
      at: '2026-02-07T03:00:53.000Z',
    })
    expect(issuer.parseWebhook({ ...movement, transaction_type: '' })).toMatchObject({ kind: 'balance-movement', type: '' })
  })

  it.each([
    ['nothing', undefined],
    ['a string', 'webhook'],
    ['no known fields', { type: 'webhook', id: 'x' }],
    ['a card state without a status', { type: 'webhook', card_id: 'card-1' }],
    ['a top-up without an id', { type: 'webhook', payment_address: '0x5d22', status: 'created' }],
    ['a card transaction without an amount', { type: 'webhook', id: 'tx-1', transaction: { card_id: 'card-1' } }],
  ])('does not recognise %s', (_, body) => {
    expect(issuer.parseWebhook(body)).toEqual({ kind: 'unrecognized' })
  })
})
