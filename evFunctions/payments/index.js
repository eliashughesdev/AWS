// `data` is the data you encrypted and passed into `evervault.run` from your server. The Function
// automatically decrypts the data and maintains its structure so you can treat event exactly as
// you did when you passed it into `evervault.run`.

exports.handler = async (data, context) => {
    console.log('Evervault Payment Proxy Function started');
    console.log('testing evervault function deploys automatically III');

    const { proxy, card_data } = data;

    if (!proxy || !card_data) {
        return {
            error: {
                message: 'Missing required parameters: proxy or card_data'
            }
        };
    }

    try {
        console.log('Proxy Method:', proxy);
        console.log('Parsing proxy configuration...');
        const proxyConfig = JSON.parse(proxy);
        console.log('Proxy URL:', proxyConfig.url);
        console.log('Proxy Method:', proxyConfig.method);
        console.log('Proxy Method:', proxyConfig);

        let bodyString = JSON.stringify(proxyConfig.body);

        // Only parse and substtiute card data if it's provded
        const hasCardData = card_data.cardData && card_data.cardData !== '' && card_data.cardData !== '{}';

        if (hasCardData) {
            console.log('Parsing card data...', card_data);
            const cardData = JSON.parse(card_data.cardData);

            console.log('Card data parsed. Last 4 digits:', cardData.number ? cardData.number.slice(-4) : 'N/A');

            if (!cardData.number || !cardData.expiry || !cardData.cvc) {
                console.error('Invalid card data structure:', cardData);
                return {
                    error: {
                        message: 'Invalid card data structure'
                    }
                };
            }

            const exp_month = cardData.expiry.month;
            const exp_year = cardData.expiry.year;
            const fullYear = exp_year.length === 2 ? `20${exp_year}` : exp_year;

            console.log('Replacing card data placeholders...');
            bodyString = bodyString.replace('{{CARD_NUMBER}}', cardData.number);
            bodyString = bodyString.replace('{{EXP_MONTH}}', exp_month);
            bodyString = bodyString.replace('{{EXP_YEAR}}', fullYear);
            bodyString = bodyString.replace('{{CVC}}', cardData.cvc);
        } else {
            console.log('No card data provided, skipping substitution (tokenized provider)');
        }

        console.log('Making request to payment provider:', proxyConfig.url);
        console.log('Request body:', bodyString);

        const response = await fetch(proxyConfig.url, {
            method: proxyConfig.method,
            headers: proxyConfig.headers,
            body: bodyString
        });

        const result = await response.json();

        console.log('Payment provider response status:', response.status);
        console.log('Payment provider response:', JSON.stringify(result, null, 2));

        return result;

    } catch (error) {
        console.error('Payment proxy error:', error.message);
        console.error('Error stack:', error.stack);

        return {
            error: {
                message: error.message,
                type: error.type || 'UnknownError'
            }
        };
    }
};
