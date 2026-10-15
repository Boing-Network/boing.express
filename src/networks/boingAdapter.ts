/**
 * Boing Network adapter: implements NetworkAdapter using Boing RPC and signing.
 * Uses boing_getAccount for balance+nonce when available; balance falls back to boing_getBalance; nonce comes only from boing_getAccount.
 * Simulates transaction before submit when boing_simulateTransaction is available.
 */

import type { AccountId } from '../boing/types';
import { accountIdToHex } from '../boing/types';
import { buildSignedTransactionHex } from '../boing/signing';
import { transactionIdFromSignedTransactionHex } from '../boing/bincode';
import { suggestedAccessList } from '../boing/accessList';
import * as rpc from '../boing/rpc';
import type { NetworkAdapter, BalanceResult, SubmitResult } from './types';
import type { NetworkConfig } from './types';
import type { Transaction, Payload } from '../boing/types';
import type { BatchStep } from './types';
import { buildBatchTransaction, nodeBatchMaxCalls, nodeSupportsNativeBatch, signTransactionInput } from 'boing-sdk';

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
      const account = await rpc.getAccount(rpcUrl, accountIdToHex(accountId));
      return BigInt(account.nonce);
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
        const mempoolAck = await rpc.submitTransaction(rpcUrl, signedTxHex);
        let txId: string | undefined;
        try {
          txId = transactionIdFromSignedTransactionHex(
            signedTxHex.startsWith('0x') ? signedTxHex : `0x${signedTxHex}`
          );
        } catch {
          txId = undefined;
        }
        return { success: true, txHash: txId ?? mempoolAck, txId, mempoolAck };
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

    async buildContractCall(
      sender: AccountId,
      contract: AccountId,
      calldata: Uint8Array,
      nonce: bigint,
      privateKey: Uint8Array
    ): Promise<string> {
      return signedNativeTx(
        sender,
        nonce,
        { kind: 'contract_call', contract, calldata },
        privateKey
      );
    },

    async getBatchSupport(): Promise<{ supported: boolean; maxSteps: number }> {
      try {
        const h = (await rpc.health(rpcUrl)) as Parameters<typeof nodeSupportsNativeBatch>[0];
        return { supported: nodeSupportsNativeBatch(h), maxSteps: nodeBatchMaxCalls(h as Parameters<typeof nodeBatchMaxCalls>[0]) };
      } catch {
        return { supported: false, maxSteps: 16 };
      }
    },

    async buildBatch(
      sender: AccountId,
      steps: BatchStep[],
      nonce: bigint,
      privateKey: Uint8Array
    ): Promise<string> {
      const senderHex = `0x${accountIdToHex(sender).replace(/^0x/i, '')}`;
      const norm = (h: string) => `0x${h.replace(/^0x/i, '').toLowerCase()}`;
      const tx = buildBatchTransaction({
        nonce,
        senderHex,
        calls: steps.map((s) =>
          s.kind === 'transfer'
            ? { kind: 'transfer' as const, toHex: norm(s.toHex), amount: s.amount }
            : { kind: 'contractCall' as const, contractHex: norm(s.contractHex), calldata: s.calldata }
        ),
      });
      return signTransactionInput(tx, privateKey);
    },

    async simulateGas(signedTxHex: string): Promise<{ success: boolean; gasUsed?: bigint; error?: string }> {
      try {
        const r = (await rpc.simulateTransaction(rpcUrl, signedTxHex)) as {
          success?: boolean;
          gas_used?: number | string;
          error?: string;
        } | null;
        if (!r || typeof r !== 'object') return { success: true };
        const gas = r.gas_used != null ? BigInt(r.gas_used) : undefined;
        return { success: r.success !== false, gasUsed: gas, error: r.error };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };

  if (config.isTestnet) {
    adapter.faucetRequest = async (accountId: AccountId): Promise<{ success: boolean; error?: string; amount?: string; warning?: string }> => {
      try {
        const hex = accountIdToHex(accountId);
        const res = (await rpc.faucetRequest(rpcUrl, hex)) as { amount?: number | string; warning?: string } | null;
        return {
          success: true,
          amount: res && res.amount != null ? String(res.amount) : undefined,
          warning: res && typeof res.warning === 'string' ? res.warning : undefined,
        };
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
