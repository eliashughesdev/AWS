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
        console.log('DEBUG: AccountHandler execution started.');
        console.log('DEBUG: Incoming Event:', JSON.stringify(event));
        console.log('DEBUG: Event Body:', JSON.stringify(event.body));

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

        console.log('DEBUG: Internal Account Record (Initial):', JSON.stringify(data));

        // Attempt initial database write
        console.log('DEBUG: Attempting initial putItem to v1CustomerTable...');
        let dbResult = await putItem('v1CustomerTable', data)
        console.log('DEBUG: Initial putItem result:', JSON.stringify(dbResult));

        if (!dbResult.success || !dbResult.res) {
            console.error('ERROR: Initial DB write failed. Processing error 100003.');
            return processError(100003)
        }

        try {
            // create wallent in kms
            console.log('DEBUG: Initializing TatumKmsClient...');
            const kmsClient = new TatumKmsClient();
            const chain = event.body.chain;

            console.log(`DEBUG: Calling kmsClient.generateWallet for chain: ${chain}`);
            const { signatureId, xpub } = await kmsClient.generateWallet(chain);
            console.log(`DEBUG: Wallet generated. signatureId: ${signatureId}, xpub: ${xpub}`);

            // create virtual account
            console.log(`DEBUG: Getting provider: ${event.body.provider}`);
            const vaProvider = ProviderRegistry.getProvider(event.body.provider as ProviderName)
            const userId = data.id;

            console.log(`DEBUG: Calling vaProvider.createVaAccount for userId: ${userId}, currency: ${chain}, xpub: ${xpub}, accountingCurrency: ${event.body.accounting_currency}`);
            const { accountId } = await vaProvider.createVaAccount({ userId, currency: chain, xpub, accountingCurrency: event.body.accounting_currency });
            console.log(`DEBUG: Virtual Account created. accountId: ${accountId}`);

            // generate deposit address
            console.log(`DEBUG: Calling vaProvider.generateDepositAddress for accountId: ${accountId}`);
            const { address } = await vaProvider.generateDepositAddress(accountId);
            console.log(`DEBUG: Deposit address generated: ${address}`);

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
            console.log('DEBUG: Internal Account Record (Final update structure):', JSON.stringify(data));

            console.log('DEBUG: Attempting final putItem to v1CustomerTable...');
            dbResult = await putItem('v1CustomerTable', data);
            console.log('DEBUG: Final putItem result:', JSON.stringify(dbResult));

            if (!dbResult.success) {
                console.error('ERROR: Final DB update failed. Throwing error for rollback consideration.');
                throw new Error('Failed to update user with new wallet account structure.');
            }

            console.log('DEBUG: Account creation flow successful. Returning 200 response.');
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
            console.error('FATAL ERROR: Wallet/VA creation error:', err)
            // TODO: ROLLBACK at this point. DELETE user if account creation fails
            return processError(100002, `Failed to create virtual account and wallet`)
        }
    }
}
