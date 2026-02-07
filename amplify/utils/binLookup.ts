import { getRecord, putItem } from './db';

const BIN_CACHE_TABLE = 'v1BinCacheTable';
const CACHE_TTL_DAYS = 90;  // BIN info rarely changes, cache for 90 days

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
 * Gets BIN info from cache
 */
async function getCachedBin(bin: string): Promise<BinLookupResult | null> {
    try {
        const result = await getRecord(BIN_CACHE_TABLE, bin);
        if (result.success && result.res) {
            // Check if TTL has expired
            const now = Math.floor(Date.now() / 1000);
            if (result.res.ttl && result.res.ttl < now) {
                console.log('DEBUG: Cached BIN expired:', bin);
                return null;
            }
            console.log('DEBUG: BIN cache hit:', bin);
            return result.res as BinLookupResult;
        }
        return null;
    } catch (error) {
        console.error('Error reading BIN cache:', error);
        return null;
    }
}

/**
 * Saves BIN info to cache
 */
async function cacheBin(bin: string, data: BinLookupResult): Promise<void> {
    try {
        const ttl = Math.floor(Date.now() / 1000) + (CACHE_TTL_DAYS * 24 * 60 * 60);
        await putItem(BIN_CACHE_TABLE, {
            ...data,
            id: bin,  // partition key
            bin,
            evervaultId: data.id,
            ttl,
            cachedAt: Date.now(),
        });
        console.log('DEBUG: BIN cached:', bin);
    } catch (error) {
        console.error('Error caching BIN:', error);
    }
}

/**
 * Calls the Evervault BIN lookup API
 */
async function fetchBinFromApi(bin: string, config: BinLookupConfig): Promise<BinLookupResult | null> {
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
            console.error('BIN lookup API failed:', response.status, await response.text());
            return null;
        }

        const result = await response.json();
        console.log('DEBUG: BIN lookup API result:', JSON.stringify(result));
        return result as BinLookupResult;
    } catch (error) {
        console.error('BIN lookup API error:', error);
        return null;
    }
}

/**
 * Performs a BIN lookup - checks cache first, then calls API if needed
 * @param bin - The BIN (first 6-8 digits of card number)
 * @param config - Evervault credentials
 * @returns BIN lookup result or null if lookup fails
 */
export async function lookupBin(bin: string, config: BinLookupConfig): Promise<BinLookupResult | null> {
    // First, check the cache
    const cachedResult = await getCachedBin(bin);
    if (cachedResult) {
        return cachedResult;
    }

    console.log('DEBUG: BIN cache miss, calling API:', bin);

    // Not in cache, call the API
    const apiResult = await fetchBinFromApi(bin, config);
    if (apiResult) {
        // Save to cache for future lookups
        await cacheBin(bin, apiResult);
    }

    return apiResult;
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
