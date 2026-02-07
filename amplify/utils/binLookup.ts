export interface BinLookupResult {
    id: string;
    brand: string;
    funding: string;
    segment: string;
    country: string;  // ISO 3166-1 alpha-2
    currency: string;
    issuer: string;
    productName: string;
}

export interface BinLookupConfig {
    appId: string;
    apiKey: string;
}

/**
 * Performs a BIN lookup using the Evervault API
 * @param bin - The BIN (first 6-8 digits of card number)
 * @param config - Evervault credentials
 * @returns BIN lookup result or null if lookup fails
 */
export async function lookupBin(bin: string, config: BinLookupConfig): Promise<BinLookupResult | null> {
    try {
        const credentials = Buffer.from(`${config.appId}:${config.apiKey}`).toString('base64');

        const response = await fetch('https://api.evervault.com/payments/bin-lookups', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ number: bin }),
        });

        if (!response.ok) {
            console.error('BIN lookup failed:', response.status, await response.text());
            return null;
        }

        const result = await response.json();
        console.log('DEBUG: BIN lookup result:', JSON.stringify(result));
        return result as BinLookupResult;
    } catch (error) {
        console.error('BIN lookup error:', error);
        return null;
    }
}

/**
 * Determines the payment provider based on card country
 * US and Canada use Clover, all other countries use Stripe
 */
export function getProviderByCountry(country: string | undefined): 'clover' | 'stripe' {
    if (!country) {
        return 'stripe';  // Default to Stripe if country unknown
    }

    const upperCountry = country.toUpperCase();
    if (upperCountry === 'US' || upperCountry === 'CA') {
        return 'clover';
    }

    return 'stripe';
}
