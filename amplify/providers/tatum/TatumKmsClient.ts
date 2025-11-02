import axios, { AxiosInstance } from 'axios';

const TATUM_KMS_URL = process.env.TATUM_KMS_URL


interface KmsGenerateWalletResponse {
    success: boolean;
    output: {
        signatureId: string;
        xpub: string;
    };
    raw: string;
}

export class TatumKmsClient {
    private axiosInstance: AxiosInstance;

    constructor() {
        this.axiosInstance = axios.create({
            baseURL: TATUM_KMS_URL,
            headers: {
                'Content-Type': 'application/json',
            },
            // timeout: 15000,
        });
    }

    /**
     * Calls POST /wallet/generate to create a new managed wallet in the KMS.
     * @param chain The blockchain identifier (e.g., 'ETH', 'MATIC').
     * @returns The signatureId and xpub of the newly created wallet.
     */
    async generateWallet(chain: string): Promise<{ signatureId: string; xpub: string }> {
        try {
            const endpoint = '/wallet/generate';
            console.log(`KMS Client: Calling POST ${endpoint}`);

            const res = await this.axiosInstance.post<KmsGenerateWalletResponse>(
                endpoint,
                { chain }
            );

            const json = res.data;

            if (!json.success || !json.output.signatureId || !json.output.xpub) {
                throw new Error(`KMS command failed: ${JSON.stringify(json)}`);
            }

            const { signatureId, xpub } = json.output;
            return { signatureId, xpub };

        } catch (error) {
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const message = error.response?.data || error.message;
                throw new Error(`KMS API HTTP Error ${status}: ${JSON.stringify(message)}`);
            }
            throw error;
        }
    }
}
