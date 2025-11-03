import axios, { AxiosInstance } from 'axios';



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

        const TATUM_KMS_URL = process.env.TATUM_KMS_URL || 'https://a36fdf747de1.ngrok-free.app'
        console.log(`DEBUG (KMS Client): Initializing with base URL: ${TATUM_KMS_URL}`);
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
        const endpoint = '/wallet/generate';
        const payload = { chain };

        console.log(`DEBUG (KMS Client): Sending POST request to ${endpoint}`);
        console.log(`DEBUG (KMS Client): Payload: ${JSON.stringify(payload)}`);

        try {
            const res = await this.axiosInstance.post<KmsGenerateWalletResponse>(
                endpoint,
                payload
            );

            const json = res.data;

            console.log(`DEBUG (KMS Client): Response Status: ${res.status}`);
            console.log(`DEBUG (KMS Client): Raw KMS Response Data: ${JSON.stringify(json)}`);


            if (!json.success || !json.output || !json.output.signatureId || !json.output.xpub) {
                console.error('ERROR (KMS Client): Invalid response structure received.');
                throw new Error(`KMS command failed: ${JSON.stringify(json)}`);
            }

            const { signatureId, xpub } = json.output;

            console.log(`DEBUG (KMS Client): Successfully generated wallet. SignatureId: ${signatureId.substring(0, 8)}..., Xpub: ${xpub.substring(0, 10)}...`);

            return { signatureId, xpub };

        } catch (error) {
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const message = error.response?.data || error.message;

                console.error(`FATAL ERROR (KMS Client): Axios Error on ${endpoint}`);
                console.error(`FATAL ERROR (KMS Client): Status: ${status}`);
                console.error(`FATAL ERROR (KMS Client): Response Message/Data: ${JSON.stringify(message)}`);

                throw new Error(`KMS API HTTP Error ${status}: ${JSON.stringify(message)}`);
            }
            console.error('FATAL ERROR (KMS Client): Non-Axios Error:', error);
            throw error;
        }
    }
}
