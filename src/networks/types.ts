/**
 * Pluggable network/chain adapter interface. Boing is the first implementation;
 * other chains can be added by implementing this interface.
 */

import type { AccountId } from '../boing/types';

export interface NetworkConfig {
  id: string;
  name: string;
  rpcUrl: string;
  chainId?: string;
  explorerUrl?: string;
  faucetUrl?: string;
  isTestnet?: boolean;
}

export interface BalanceResult {
  value: string;   // decimal string (e.g. "1000000")
  symbol: string;
  decimals: number;
}

export interface SubmitResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

export interface NetworkAdapter {
  config: NetworkConfig;

  /** Get balance for account. */
  getBalance(accountId: AccountId): Promise<BalanceResult>;

  /** Get next nonce for sender (if applicable). */
  getNonce(accountId: AccountId): Promise<bigint>;

  /** Build and sign a transfer (chain-specific). Returns signed tx hex or equivalent. */
  buildTransfer(
    sender: AccountId,
    to: AccountId,
    amount: bigint,
    nonce: bigint,
    privateKey: Uint8Array
  ): Promise<string>;

  /** Submit signed transaction. */
  submitTransaction(signedTxHex: string): Promise<SubmitResult>;

  /** Request from faucet (if supported). Returns success/error. */
  faucetRequest?(accountId: AccountId): Promise<{ success: boolean; error?: string }>;

  /** Optional: current chain height for sync status. */
  getChainHeight?(): Promise<number>;
}
