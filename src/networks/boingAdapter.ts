/**
 * Boing Network adapter: implements NetworkAdapter using Boing RPC and signing.
 * Uses boing_getAccount for balance+nonce when available; falls back to getBalance+getNonce.
 * Simulates transaction before submit when boing_simulateTransaction is available.
 */

import type { AccountId } from '../boing/types';
import { accountIdToHex } from '../boing/types';
import { buildSignedTransactionHex } from '../boing/signing';
import { suggestedAccessList } from '../boing/accessList';
import * as rpc from '../boing/rpc';
import type { NetworkAdapter, BalanceResult, SubmitResult } from './types';
import type { NetworkConfig } from './types';
import type { Transaction, Payload } from '../boing/types';

/**
 * Native BOING ledger amounts are whole on-chain units (RPC u128 decimal strings).
 * DEX / reference tokens often use 18 display decimals; do not confuse the two.
 */
const BOING_DECIMALS = 0;
const BOING_SYMBOL = 'BOING';

function signedNativeTx(
  sender: AccountId,
  nonce: bigint,
  payload: Payload,
  privateKey: Uint8Array
): Promise<string> {
  const tx: Transaction = {
    nonce,
    sender,
    payload,
    access_list: suggestedAccessList(sender, payload),
  };
  return buildSignedTransactionHex(tx, privateKey);
}

export function createBoingAdapter(config: NetworkConfig): NetworkAdapter {
  const rpcUrl = config.rpcUrl;
  const adapter: NetworkAdapter = {
    config,

    async getBalance(accountId: AccountId): Promise<BalanceResult> {
      const hex = accountIdToHex(accountId);
      try {
        const account = await rpc.getAccount(rpcUrl, hex);
        return {
          value: account.balance,
          symbol: BOING_SYMBOL,
          decimals: BOING_DECIMALS,
        };
      } catch (error) {
        if (!rpc.isMethodNotFoundError(error)) throw error;
        const raw = await rpc.getBalance(rpcUrl, hex);
        return {
          value: raw,
          symbol: BOING_SYMBOL,
          decimals: BOING_DECIMALS,
        };
      }
    },

    async getNonce(accountId: AccountId): Promise<bigint> {
      const hex = accountIdToHex(accountId);
      try {
        const account = await rpc.getAccount(rpcUrl, hex);
        return BigInt(account.nonce);
      } catch (error) {
        if (!rpc.isMethodNotFoundError(error)) throw error;
        return rpc.getNonce(rpcUrl, hex);
      }
    },

    async buildTransfer(
      sender: AccountId,
      to: AccountId,
      amount: bigint,
      nonce: bigint,
      privateKey: Uint8Array
    ): Promise<string> {
      return signedNativeTx(sender, nonce, { kind: 'transfer', to, amount }, privateKey);
    },

    async buildBond(
      sender: AccountId,
      amount: bigint,
      nonce: bigint,
      privateKey: Uint8Array
    ): Promise<string> {
      return signedNativeTx(sender, nonce, { kind: 'bond', amount }, privateKey);
    },

    async buildUnbond(
      sender: AccountId,
      amount: bigint,
      nonce: bigint,
      privateKey: Uint8Array
    ): Promise<string> {
      return signedNativeTx(sender, nonce, { kind: 'unbond', amount }, privateKey);
    },

    async buildClaimUnbond(
      sender: AccountId,
      nonce: bigint,
      privateKey: Uint8Array
    ): Promise<string> {
      return signedNativeTx(sender, nonce, { kind: 'claim_unbond' }, privateKey);
    },

    async getStake(accountId: AccountId): Promise<string> {
      const hex = accountIdToHex(accountId);
      try {
        const account = await rpc.getAccount(rpcUrl, hex);
        return account.stake ?? '0';
      } catch (error) {
        if (!rpc.isMethodNotFoundError(error)) throw error;
        return '0';
      }
    },

    async getUnbondStatus(accountId: AccountId): Promise<{
      pendingUnbond: string;
      unlockHeight: number;
    }> {
      const hex = accountIdToHex(accountId);
      try {
        const account = await rpc.getAccount(rpcUrl, hex);
        return {
          pendingUnbond: account.pendingUnbond ?? '0',
          unlockHeight: account.unbondUnlockHeight ?? 0,
        };
      } catch (error) {
        if (!rpc.isMethodNotFoundError(error)) throw error;
        return { pendingUnbond: '0', unlockHeight: 0 };
      }
    },

    async submitTransaction(signedTxHex: string): Promise<SubmitResult> {
      try {
        try {
          const simRaw = await rpc.simulateTransaction(rpcUrl, signedTxHex);
          if (
            simRaw &&
            typeof simRaw === 'object' &&
            !Array.isArray(simRaw) &&
            (simRaw as { success?: boolean }).success === false
          ) {
            const err = (simRaw as { error?: string }).error?.trim();
            return { success: false, error: err || 'Simulation reported failure.' };
          }
        } catch (simErr) {
          const msg = simErr instanceof Error ? simErr.message : String(simErr);
          if (msg.includes('Method not found')) {
            // Node may not support simulate; proceed to submit
          } else {
            return { success: false, error: msg };
          }
        }
        const txHash = await rpc.submitTransaction(rpcUrl, signedTxHex);
        return { success: true, txHash };
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },

    async getChainHeight(): Promise<number> {
      return rpc.chainHeight(rpcUrl);
    },
  };

  if (config.isTestnet) {
    adapter.faucetRequest = async (accountId: AccountId): Promise<{ success: boolean; error?: string }> => {
      try {
        const hex = accountIdToHex(accountId);
        await rpc.faucetRequest(rpcUrl, hex);
        return { success: true };
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    };
  }

  return adapter;
}
