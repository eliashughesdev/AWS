import axios from 'axios';
import { CreateAccountParams, CreateAccountResponse, AccountProvider, TransferFundsParams, TransferFundsResponse, CustomerAccount } from '../provider';

export class TatumProvider implements AccountProvider {
    private readonly apiKey = process.env.TATUM_API_KEY;
    private readonly TATUM_BASE_URL = process.env.TATUM_BASE_URL || 'https://api.tatum.io/v3';

    async createVaAccount({ userId, currency, xpub }: CreateAccountParams): Promise<CreateAccountResponse> {
        const res = await axios.post(`${this.TATUM_BASE_URL}/ledger/account`, {
            currency,
            customer: { externalId: userId },
            xpub
        },
        {
            headers: { 'x-api-key': this.apiKey }
        });
        return { accountId: res.data.id };
    }

    async getCustomerAccounts(customerId: string): Promise<{ accounts: CustomerAccount[] }> {
        const res = await axios.get(
            `${this.TATUM_BASE_URL}/ledger/account/customer/${customerId}?pageSize=50`,
            {
                headers: { 'x-api-key': this.apiKey }
            }
        )

        return { accounts: res.data as CustomerAccount[] }
    }


    async transferFunds({ fromId, toId, amount }: TransferFundsParams): Promise<TransferFundsResponse> {
        const res = await axios.post('https://api.tatum.io/v3/ledger/transaction', {
            senderAccountId: fromId,
            recipientAccountId: toId,
            amount,
        }, {
            headers: { 'x-api-key': this.apiKey }
        });
        return { txId: res.data.id };
    }

    async getXpub(chaniName: string): Promise<{ xpub: string }> {
        return { xpub: "EXAMPLE_XPUB_FOR_ILUSTRATIVE_POUPOSES_REAL_ONE_SHOULD_COME_FROM_KMS" };
    }

    async generateDepositAddress(accountId: string): Promise<{ address: string }> {
        try {
            const response = await axios.post(
                `https://api.tatum.io/v3/offchain/account/${accountId}/address`,
                {},
                {
                    headers: {
                        'x-api-key': process.env.TATUM_API_KEY!,
                        'Content-Type': 'application/json',
                    },
                }
            )

            return { address: response.data as string }
        } catch (error) {
            console.error('Failed to generate deposit address:', error)
            throw new Error('Unable to generate deposit address')
        }
    }
}
