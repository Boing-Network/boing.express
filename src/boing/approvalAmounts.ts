/**
 * Native-amount context for dApp approval prompts (extension popup + web /sign): the ledger decimals of the block
 * the tx will land in and a simulated network fee. Nothing is broadcast; the fee is best effort (omitted on error).
 */
import type { NativeAmountContext } from './dappTxRequest';
import { feeFromGasForDecimals, nextBlockLedgerDecimals } from './nativeUnit';
import { simulateTransaction } from './rpc';
import { buildSignedTransactionHex, signingChainIdForRpc } from './signing';
import type { Transaction } from './types';

const FEE_TIMEOUT_MS = 6_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

type SimResult = { success?: boolean; gas_used?: number | string; network_fee?: string; network_fee_decimals?: number } | null;

/** Turn a `boing_simulateTransaction` result into an approval fee (null when the node reports nothing usable). */
export function feeFromSimulation(r: unknown, decimals: number): NativeAmountContext['fee'] {
  const s = r as SimResult;
  if (!s || typeof s !== 'object' || s.success === false) return null;
  if (typeof s.network_fee === 'string' && /^\d+$/.test(s.network_fee)) {
    return {
      amount: BigInt(s.network_fee),
      decimals: typeof s.network_fee_decimals === 'number' ? s.network_fee_decimals : decimals,
      exact: true,
    };
  }
  if (s.gas_used != null && /^\d+$/.test(String(s.gas_used)) && BigInt(s.gas_used) > 0n) {
    return { amount: feeFromGasForDecimals(BigInt(s.gas_used), decimals), decimals, exact: true };
  }
  return null;
}

export async function approvalAmountContext(
  rpcUrl: string,
  tx: Transaction,
  privateKey: Uint8Array | null | undefined
): Promise<NativeAmountContext> {
  const decimals = await nextBlockLedgerDecimals(rpcUrl);
  if (!privateKey) return { decimals, fee: null };
  try {
    const fee = await withTimeout(
      (async () => {
        const hex = await buildSignedTransactionHex(tx, privateKey, await signingChainIdForRpc(rpcUrl));
        const r = await simulateTransaction(rpcUrl, hex.startsWith('0x') ? hex : `0x${hex}`);
        return feeFromSimulation(r, decimals);
      })(),
      FEE_TIMEOUT_MS
    );
    return { decimals, fee: fee ?? null };
  } catch {
    return { decimals, fee: null };
  }
}
