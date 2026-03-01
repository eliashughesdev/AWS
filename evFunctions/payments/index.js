// `data` is the data you encrypted and passed into `evervault.run` from your server. The Function
// automatically decrypts the data and maintains its structure so you can treat event exactly as
// you did when you passed it into `evervault.run`.

exports.handler = async (data, context) => {
  console.log('Evervault Payment Proxy Function started')
  console.log('testing evervault function deploys automatically III')

  const { proxy } = data
  const _cardData = data.card_data

  if (!proxy || !_cardData) {
    return {
      error: {
        message: 'Missing required parameters: proxy or card_data'
      }
    }
  }

  try {
    console.log('Proxy Method:', proxy)
    console.log('Parsing proxy configuration...')
    const proxyConfig = JSON.parse(proxy)
    console.log('Proxy URL:', proxyConfig.url)
    console.log('Proxy Method:', proxyConfig.method)
    console.log('Proxy Method:', proxyConfig)

    // Only parse and substitute card data if it's provided
    const hasCardData = _cardData.cardData && _cardData.cardData !== '' && _cardData.cardData !== '{}'

    if (hasCardData) {
      console.log('Parsing card data...', _cardData)
      const cardData = JSON.parse(_cardData.cardData)

      console.log('Card data parsed. Last 4 digits:', cardData.number ? cardData.number.slice(-4) : 'N/A')

      if (!cardData.number || !cardData.expiry || !cardData.cvc) {
        console.error('Invalid card data structure:', cardData)
        return {
          error: {
            message: 'Invalid card data structure'
          }
        }
      }

      const expMonth = cardData.expiry.month
      const expYear = cardData.expiry.year
      const fullYear = expYear.length === 2 ? `20${expYear}` : expYear

      console.log('Replacing card data placeholders...')
      const replacements = {
        '{{CARD_NUMBER}}': cardData.number,
        '{{EXP_MONTH}}': expMonth,
        '{{EXP_YEAR}}': fullYear,
        '{{CVC}}': cardData.cvc,
      }
      function replacePlaceholders(obj) {
        for (const key of Object.keys(obj)) {
          if (typeof obj[key] === 'string') {
            for (const [placeholder, value] of Object.entries(replacements)) {
              obj[key] = obj[key].replace(placeholder, value)
            }
          } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            replacePlaceholders(obj[key])
          }
        }
      }
      replacePlaceholders(proxyConfig.body)
    } else {
      console.log('No card data provided, skipping substitution (tokenized provider)')
    }

    // Serialize body after placeholder substitution
    const contentType = (proxyConfig.headers['Content-Type'] || proxyConfig.headers['content-type'] || '').toLowerCase()
    let bodyString
    if (contentType.includes('application/x-www-form-urlencoded')) {
      bodyString = new URLSearchParams(proxyConfig.body).toString()
    } else {
      bodyString = JSON.stringify(proxyConfig.body)
    }

    console.log('Making request to payment provider:', proxyConfig.url)
    console.log('Request body:', bodyString)

    const response = await fetch(proxyConfig.url, {
      method: proxyConfig.method,
      headers: proxyConfig.headers,
      body: bodyString
    })

    const result = await response.json()

    console.log('Payment provider response status:', response.status)
    console.log('Payment provider response:', JSON.stringify(result, null, 2))

    return result
  } catch (error) {
    console.error('Payment proxy error:', error.message)
    console.error('Error stack:', error.stack)

    return {
      error: {
        message: error.message,
        type: error.type || 'UnknownError'
      }
    }
  }
}
