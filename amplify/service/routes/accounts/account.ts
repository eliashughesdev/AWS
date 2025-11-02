import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { putItem } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ProviderName'
import { TatumKmsClient } from '../../../providers/tatum/TatumKmsClient';

/**
 * Creates new account (internal)
 */
export default class AccountHandler {
    async execute(event: any, context: Context) {
        const data: any = {
            id: crypto.randomUUID(),
            created_at: Date.now(),
            currency: event.body.accounting_currency,
            deleted_at: null,
            fees: 'default',
            name: event.body.account_name,
            providerId: 'default',
            status: 'active',
            updated_at: Date.now(),
            accounts: [],
        }

        let dbResult = await putItem('v1CustomerTable', data)
        if (!dbResult.success || !dbResult.res) return processError(100003)

        try {
			// create wallent in kms
            const kmsClient = new TatumKmsClient();
            const chain = data.currency;
            const { signatureId, xpub } = await kmsClient.generateWallet(chain);

			// create virtual account
            const vaProvider = ProviderRegistry.getProvider(event.provider as ProviderName)
            const userId = data.id;
            const { accountId } = await vaProvider.createVaAccount({ userId, currency: chain, xpub });

			// generate deposit address
            const { address } = await vaProvider.generateDepositAddress(accountId);

            const newAccount = {
                provider: event.body.provider,
                chain: chain,
                xpub: xpub,
                signatureId: signatureId,
                depositAddress: address,
                vAccountId: accountId,
                created_at: Date.now(),
            };

            data.accounts.push(newAccount);

            dbResult = await putItem('v1CustomerTable', data);
            if (!dbResult.success) {
                throw new Error('Failed to update user with new wallet account structure.');
            }

            return response({
                statusCode: 200,
                headers: null,
                bodyObject: {
                    success: true,
                    res: {
                        data: {
                            id: data.id,
                            vAccountId: accountId,
                            depositAddress: address,
                            signatureId: signatureId
                        }
                    }
                }
            });

        } catch (err) {
            console.error('Wallet/VA creation error:', err)
            // TODO: ROLLBACK at this point. DELETE user if account creation fails
            return processError(100002, `Failed to create virtual account and wallet`)
        }
    }
}
