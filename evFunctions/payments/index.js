// `data` is the data you encrypted and passed into `evervault.run` from your server. The Function
// automatically decrypts the data and maintains its structure so you can treat event exactly as
// you did when you passed it into `evervault.run`.
const Stripe = require('stripe');

exports.handler = async (data, context) => {
    console.log('Evervault Function: Processing payment data:', JSON.stringify(data));

    const { cardData, amount, currency, userId } = data;
    console.log('Received parameters - amount:', amount, 'currency:', currency, 'userId:', userId);

    if (!cardData || !amount || !currency || !userId) {
        return {
            success: false,
            error: 'Missing required parameters: cardData, amount, currency, userId'
        };
    }

    try {
        let card;

        if (typeof cardData.cardData === 'string') {
            card = JSON.parse(cardData.cardData);
        } else if (cardData.number) {
            card = cardData;
        } else {
            console.error('Unexpected cardData structure:', cardData);
            return {
                success: false,
                error: 'Invalid card data structure'
            };
        }

        if (!card.number || !card.expiry || !card.cvc) {
            console.error('Missing card fields. Card structure:', JSON.stringify(card));
            return {
                success: false,
                error: 'Missing required card fields (number, expiry, cvc)'
            };
        }

        console.log('Card last 4 digits:', card.number.slice(-4));

        // Initialize Stripe
        const stripe = new Stripe(process.env.STRIPE_API_KEY);

        // Parse expiry
        const exp_month = parseInt(card.expiry.month, 10);
        const exp_year = parseInt(card.expiry.year, 10);
        const fullYear = exp_year < 100 ? 2000 + exp_year : exp_year;

        // console.log('Creating Stripe token...');
        // const token = await stripe.tokens.create({
        //     card: {
        //         number: card.number,
        //         exp_month: exp_month,
        //         exp_year: fullYear,
        //         cvc: card.cvc,
        //     }
        // });

        // console.log('Stripe token created:', token.id);

        console.log('Creating payment method from token...');
        // const paymentMethod = await stripe.paymentMethods.create({
        //     type: 'card',
        //     card: {
        //         token: token.id
        //     }
        // });
        const paymentMethod = await stripe.paymentMethods.create({
            type: 'card',
            card: {
                token: 'tok_visa'  // Stripe's generic test token
            }
        });

        console.log('Payment method created:', paymentMethod.id);

        console.log('Creating payment intent...');
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: currency,
            payment_method: paymentMethod.id,
            confirm: true,
            automatic_payment_methods: { enabled: false },
            payment_method_types: ['card']
        });

        console.log('Payment intent created:', paymentIntent.id, 'Status:', paymentIntent.status);

        return {
            success: true,
            transactionId: paymentIntent.id,
            status: paymentIntent.status,
        };

    } catch (error) {
        console.error('Payment processing error:', error.message);
        console.error('Error type:', error.type);
        console.error('Error code:', error.code);

        return {
            success: false,
            error: error.message,
            errorType: error.type,
            errorCode: error.code,
        };
    }
};
