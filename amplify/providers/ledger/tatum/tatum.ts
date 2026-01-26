import axios from 'axios';
import { CreateAccountParams, CreateAccountResponse, AccountProvider, TransferFundsParams, TransferFundsResponse, CustomerAccount, AssignDepositAddressResponse, AssignDepositAddressParams, GenerateDepositAddressResponse } from '../provider';

export class TatumProvider implements AccountProvider {
    private readonly apiKey = process.env.TATUM_API_KEY;
    private readonly TATUM_BASE_URL = process.env.TATUM_BASE_URL || 'https://api.tatum.io/v3';

    async createVaAccount({ userId, currency, xpub, accountingCurrency }: CreateAccountParams): Promise<CreateAccountResponse> {
        const url = `${this.TATUM_BASE_URL}/ledger/account`;
        const payload = {
            currency,
            customer: { externalId: userId },
            xpub,
            accountingCurrency
        };

        console.log('DEBUG (TatumProvider): Calling createVaAccount.');
        console.log(`DEBUG (TatumProvider): POST URL: ${url}`);
        console.log(`DEBUG (TatumProvider): Payload: ${JSON.stringify(payload)}`);

        try {
            const res = await axios.post(url, payload,
            {
                headers: { 'x-api-key': this.apiKey }
            });

            console.log(`DEBUG (TatumProvider): Response status: ${res.status}. Account ID: ${res.data?.id}`);
            return { accountId: res.data.id };
        } catch (error) {
            console.error('ERROR (TatumProvider): Failed to create VA Account.', error);
            throw error; // Re-throw to be caught by the calling handler
        }
    }

    async getCustomerAccounts(customerId: string): Promise<{ accounts: CustomerAccount[] }> {
        const url = `${this.TATUM_BASE_URL}/ledger/account/customer/${customerId}?pageSize=50`;

        console.log('DEBUG (TatumProvider): Calling getCustomerAccounts.');
        console.log(`DEBUG (TatumProvider): GET URL: ${url}`);

        try {
            const res = await axios.get(
                url,
                {
                    headers: { 'x-api-key': this.apiKey }
                }
            )

            console.log(`DEBUG (TatumProvider): Response status: ${res.status}. Accounts received: ${res.data?.length}`);
            return { accounts: res.data as CustomerAccount[] }
        } catch (error) {
            console.error('ERROR (TatumProvider): Failed to get customer accounts.', error);
            throw error;
        }
    }


    async transferFunds({ senderAccountId, recipientAccountId, amount }: TransferFundsParams): Promise<TransferFundsResponse> {
        const url = `${this.TATUM_BASE_URL}/ledger/transaction`;
        const payload = {
            senderAccountId: senderAccountId,
            recipientAccountId: recipientAccountId,
            amount,
        };

        console.log('DEBUG (TatumProvider): Calling transferFunds.');
        console.log(`DEBUG (TatumProvider): POST URL: ${url}`);
        console.log(`DEBUG (TatumProvider): Payload: ${JSON.stringify(payload)}`);

        try {
            const res = await axios.post(url, payload, {
                headers: { 'x-api-key': this.apiKey }
            });

            console.log(`DEBUG (TatumProvider): Response status: ${res.status}. Transaction ID: ${res.data?.id}`);
            return { reference: res.data.id };
        } catch (err) {
            console.error('ERROR (TatumProvider): Failed to transfer funds.', err);
            throw err;
        }
    }

    async getXpub(chaniName: string): Promise<{ xpub: string }> {
        // NOTE: This implementation returns a hardcoded placeholder.
        console.log('DEBUG (TatumProvider): Calling getXpub (Returning placeholder).');
        return { xpub: "EXAMPLE_XPUB_FOR_ILUSTRATIVE_POUPOSES_REAL_ONE_SHOULD_COME_FROM_KMS" };
    }

    async generateDepositAddress(accountId: string): Promise<GenerateDepositAddressResponse> {
        const url = `${this.TATUM_BASE_URL}/offchain/account/${accountId}/address`;

        console.log('DEBUG (TatumProvider): Calling generateDepositAddress.');
        console.log(`DEBUG (TatumProvider): POST URL: ${url}`);

        try {
            const response = await axios.post(
                url,
                {},
                {
                    headers: {
                        'x-api-key': process.env.TATUM_API_KEY!,
                        'Content-Type': 'application/json',
                    },
                }
            )

            console.log(`DEBUG (TatumProvider): Response status: ${response.status}. Generated address: ${response.data}`);
            return response.data as GenerateDepositAddressResponse;
        } catch (error) {
            console.error('ERROR (TatumProvider): Failed to generate deposit address:', error);
            throw new Error('Unable to generate deposit address')
        }
    }

    async assignDepositAddress({ accountId, address }: AssignDepositAddressParams): Promise<AssignDepositAddressResponse> {
        const url = `${this.TATUM_BASE_URL}/offchain/account/${accountId}/address/${address}`;

        console.log('DEBUG (TatumProvider): Calling assignDepositAddress.');
        console.log(`DEBUG (TatumProvider): PUT URL: ${url}`);

        try {
            // Tatum uses a PUT request to link an existing address to a VA
            const res = await axios.post(
                url,
                {}, // No body required for this Tatum endpoint
                {
                    headers: { 'x-api-key': this.apiKey }
                }
            );

            // The response typically returns the address, confirming the link.
            console.log(`DEBUG (TatumProvider): Response status: ${res.status}. Assigned address: ${res.data?.address || address}`);
            return { address: res.data?.address || address };
        } catch (error) {
            console.error(`ERROR (TatumProvider): Failed to assign address ${address} to VA ${accountId}.`, error);
            throw new Error('Unable to assign external deposit address');
        }
    }
}
