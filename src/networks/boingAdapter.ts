/**
 * Boing Network adapter: implements NetworkAdapter using Boing RPC and signing.
 * Uses boing_getAccount for balance+nonce when available; balance falls back to boing_getBalance; nonce comes only from boing_getAccount.
 * Simulates transaction before submit when boing_simulateTransaction is available.
 */

import type { AccountId } from '../boing/types';
import { accountIdToHex } from '../boing/types';
import { buildSignedTransactionHex, signingChainIdForRpc } from '../boing/signing';
import { transactionIdFromSignedTransactionHex } from '../boing/bincode';
import { suggestedAccessList } from '../boing/accessList';
import * as rpc from '../boing/rpc';
import type { NetworkAdapter, BalanceResult, SubmitResult } from './types';
import type { NetworkConfig } from './types';
import type { Transaction, Payload } from '../boing/types';
import type { BatchStep } from './types';
import {
  buildBatchTransaction,
  buildTransferTransaction,
  nodeBatchMaxCalls,
  nodeSupportsNativeBatch,
  signTransactionInput,
  withPriorityTip,
} from 'boing-sdk';
import { boingNumber, currentLedgerDecimals, fetchNativeCurrency, knownLedgerDecimals, rememberLedgerDecimals } from '../boing/nativeUnit';

/**
 * Native BOING has 18 decimals (1 BOING = 10^18 base units). The node returns ledger units: base units
 * from the 18-decimals switch (testnet 6913: height 1050), whole BOING before it. `boing_getAccount`
 * says which (`decimals`); older nodes omit it, then `native_currency` from network info decides.
 * Token decimals are separate (their own metadata).
 */
const BOING_SYMBOL = 'BOING';

async function signedNativeTx(
  rpcUrl: string,
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
  return buildSignedTransactionHex(tx, privateKey, await signingChainIdForRpc(rpcUrl));
}

export function createBoingAdapter(config: NetworkConfig): NetworkAdapter {
  const rpcUrl = config.rpcUrl;
  const adapter: NetworkAdapter = {
    config,

    async getBalance(accountId: AccountId): Promise<BalanceResult> {
      const hex = accountIdToHex(accountId);
      try {
        const account = await rpc.getAccount(rpcUrl, hex);
        const decimals = account.decimals ?? (await currentLedgerDecimals(rpcUrl));
        rememberLedgerDecimals(rpcUrl, decimals);
        return {
          value: account.balance,
          symbol: BOING_SYMBOL,
          decimals,
        };
      } catch (error) {
        if (!rpc.isMethodNotFoundError(error)) throw error;
        const raw = (await rpc.getBalance(rpcUrl, hex)) as unknown;
        const obj = raw && typeof raw === 'object' ? (raw as { balance?: string; decimals?: number }) : null;
        const decimals = obj?.decimals ?? (await currentLedgerDecimals(rpcUrl));
        rememberLedgerDecimals(rpcUrl, decimals);
        return {
          value: obj ? String(obj.balance ?? '0') : String(raw),
          symbol: BOING_SYMBOL,
          decimals,
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
      privateKey: Uint8Array,
      priorityTip: bigint = 0n
    ): Promise<string> {
      const senderHex = `0x${accountIdToHex(sender).replace(/^0x/i, '')}`;
      const toHex = `0x${accountIdToHex(to).replace(/^0x/i, '')}`;
      const al = suggestedAccessList(sender, { kind: 'transfer', to, amount });
      const read = al.read.map((id) => accountIdToHex(id));
      const write = al.write.map((id) => accountIdToHex(id));
      const tx = withPriorityTip(
        buildTransferTransaction({ nonce, senderHex, toHex, amount, accessList: { read, write } }),
        priorityTip < 0n ? 0n : priorityTip
      );
      return signTransactionInput(tx, privateKey, { chainId: await signingChainIdForRpc(rpcUrl) });
    },

    async buildBond(
      sender: AccountId,
      amount: bigint,
      nonce: bigint,
      privateKey: Uint8Array
    ): Promise<string> {
      return signedNativeTx(rpcUrl, sender, nonce, { kind: 'bond', amount }, privateKey);
    },

    async buildUnbond(
      sender: AccountId,
      amount: bigint,
      nonce: bigint,
      privateKey: Uint8Array
    ): Promise<string> {
      return signedNativeTx(rpcUrl, sender, nonce, { kind: 'unbond', amount }, privateKey);
    },

    async buildClaimUnbond(
      sender: AccountId,
      nonce: bigint,
      privateKey: Uint8Array
    ): Promise<string> {
      return signedNativeTx(rpcUrl, sender, nonce, { kind: 'claim_unbond' }, privateKey);
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

    async getNativeCurrency() {
      return fetchNativeCurrency(rpcUrl);
    },

    async buildContractCall(
      sender: AccountId,
      contract: AccountId,
      calldata: Uint8Array,
      nonce: bigint,
      privateKey: Uint8Array
    ): Promise<string> {
      return signedNativeTx(
        rpcUrl,
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
      return signTransactionInput(tx, privateKey, { chainId: await signingChainIdForRpc(rpcUrl) });
    },

    async simulateGas(signedTxHex: string): Promise<{
      success: boolean;
      gasUsed?: bigint;
      error?: string;
      networkFee?: bigint;
      feeDecimals?: number;
    }> {
      try {
        const r = (await rpc.simulateTransaction(rpcUrl, signedTxHex)) as {
          success?: boolean;
          gas_used?: number | string;
          error?: string;
          network_fee?: string;
          network_fee_decimals?: number;
        } | null;
        if (!r || typeof r !== 'object') return { success: true };
        const gas = r.gas_used != null ? BigInt(r.gas_used) : undefined;
        // testnet-v0.1.17+: exact fee for the next block in ledger units.
        const networkFee = typeof r.network_fee === 'string' && /^\d+$/.test(r.network_fee) ? BigInt(r.network_fee) : undefined;
        return {
          success: r.success !== false,
          gasUsed: gas,
          error: r.error,
          networkFee,
          feeDecimals: typeof r.network_fee_decimals === 'number' ? r.network_fee_decimals : undefined,
        };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };

  if (config.isTestnet) {
    adapter.faucetRequest = async (accountId: AccountId): Promise<{ success: boolean; error?: string; amount?: string; warning?: string }> => {
      try {
        const hex = accountIdToHex(accountId);
        const res = (await rpc.faucetRequest(rpcUrl, hex)) as {
          amount?: number | string;
          amount_boing?: string;
          decimals?: number;
          warning?: string;
        } | null;
        return {
          success: true,
          // `amount` is in ledger units (base units from the 18-decimals switch); show BOING.
          amount: boingNumber(res?.amount_boing, res?.amount, typeof res?.decimals === 'number' ? res.decimals : knownLedgerDecimals(rpcUrl)),
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
