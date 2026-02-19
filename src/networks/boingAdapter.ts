/**
 * Boing Network adapter: implements NetworkAdapter using Boing RPC and signing.
 */

import type { AccountId } from '../boing/types';
import { accountIdToHex } from '../boing/types';
import { buildSignedTransactionHex } from '../boing/signing';
import * as rpc from '../boing/rpc';
import type { NetworkAdapter, BalanceResult, SubmitResult } from './types';
import type { NetworkConfig } from './types';
import type { Transaction, Payload, AccessList } from '../boing/types';

const BOING_DECIMALS = 18;
const BOING_SYMBOL = 'BOING';

function emptyAccessList(): AccessList {
  return { read: [], write: [] };
}

export function createBoingAdapter(config: NetworkConfig): NetworkAdapter {
  const rpcUrl = config.rpcUrl;

  return {
    config,

    async getBalance(accountId: AccountId): Promise<BalanceResult> {
      const hex = accountIdToHex(accountId);
      const raw = await rpc.getBalance(rpcUrl, hex);
      return {
        value: raw,
        symbol: BOING_SYMBOL,
        decimals: BOING_DECIMALS,
      };
    },

    async getNonce(accountId: AccountId): Promise<bigint> {
      const hex = accountIdToHex(accountId);
      return rpc.getNonce(rpcUrl, hex);
    },

    async buildTransfer(
      sender: AccountId,
      to: AccountId,
      amount: bigint,
      nonce: bigint,
      privateKey: Uint8Array
    ): Promise<string> {
      const payload: Payload = { tag: 0, to, amount };
      const tx: Transaction = {
        nonce,
        sender,
        payload,
        access_list: emptyAccessList(),
      };
      return buildSignedTransactionHex(tx, privateKey);
    },

    async submitTransaction(signedTxHex: string): Promise<SubmitResult> {
      try {
        const txHash = await rpc.submitTransaction(rpcUrl, signedTxHex);
        return { success: true, txHash };
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },

    async faucetRequest(accountId: AccountId): Promise<{ success: boolean; error?: string }> {
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
    },
  };
}
