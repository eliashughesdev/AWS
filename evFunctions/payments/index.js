// `data` is the data you encrypted and passed into `evervault.run` from your server. The Function
// automatically decrypts the data and maintains its structure so you can treat event exactly as
// you did when you passed it into `evervault.run`.
const Stripe = require('stripe');

exports.handler = async (data, context) => {
    console.log('Evervault Function: Processing payment data:', JSON.stringify(data));

    const { cardData, amount, currency, userId } = data;

    if (!cardData || !amount || !currency || !userId) {
        return {
            success: false,
            error: 'Missing required parameters: cardData, amount, currency, userId'
        };
    }

    try {
        // Parse the decrypted cardData string to JSON
        const parsedCardData = JSON.parse(cardData);
        const card = parsedCardData.card;

        console.log('Parsed card data:', JSON.stringify(card));

        // Initialize Stripe
        const stripe = new Stripe(process.env.STRIPE_API_KEY);

        // Parse expiry
        const exp_month = parseInt(card.expiry.month, 10);
        const exp_year = 2000 + parseInt(card.expiry.year, 10);

        const cardPayload = {
            number: card.number,
            exp_month: exp_month,
            exp_year,
            cvc: card.cvc,
        };

        console.log('Creating payment method with card payload...');

        // Create payment method
        const paymentMethod = await stripe.paymentMethods.create({
            type: 'card',
            card: cardPayload,
        });

        console.log('Payment method created:', paymentMethod.id);

        // Create and confirm payment intent
        console.log('Creating payment intent...');
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: currency,
            payment_method: paymentMethod.id,
            confirm: true,
            automatic_payment_methods: { enabled: false },
        });

        console.log('Payment intent created:', paymentIntent.id);

        return {
            success: true,
            transactionId: paymentIntent.id,
        };

    } catch (error) {
        console.error('Payment processing error:', error);
        return {
            success: false,
            error: error.message,
        };
    }
};
