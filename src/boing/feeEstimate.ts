import type { NetworkAdapter } from '../networks/types';
import { feeFromGasForDecimals, formatNative, knownLedgerDecimals } from './nativeUnit';

/** `fee` is in ledger units with `decimals` (18 = base units, 0 = whole BOING). */
export type FeeEstimate =
  | { state: 'ok'; fee: bigint; exact: boolean; decimals: number }
  | { state: 'fail'; error: string };

/** Gas of a plain transfer, used when the node reports no gas. */
export const DEFAULT_TX_GAS = 21_000n;

/** Fee of a plain transfer when the node reports no gas (21 000 gas). */
export function defaultTxFee(decimals: number): bigint {
  return feeFromGasForDecimals(DEFAULT_TX_GAS, decimals);
}

/** @deprecated whole-BOING era constant (1 BOING); use {@link defaultTxFee}. */
export const DEFAULT_TX_FEE = 1n;

/**
 * Simulate the exact signed tx(s) the user is about to send (`boing_simulateTransaction`) and turn it into a
 * BOING fee: the node's `network_fee` when it reports one (testnet-v0.1.17+), else gas under the ledger unit's
 * rule. `count` multiplies a per-tx fee (NFT multi-select sends one tx per item). Nothing is broadcast.
 * `decimals`: ledger decimals of the account's balance (defaults to the last seen for this RPC).
 */
export async function estimateSendFee(
  network: NetworkAdapter,
  buildSigned: () => Promise<string>,
  count = 1,
  decimals: number = knownLedgerDecimals(network.config?.rpcUrl ?? '')
): Promise<FeeEstimate> {
  const n = BigInt(Math.max(1, count));
  if (!network.simulateGas) return { state: 'ok', fee: defaultTxFee(decimals) * n, exact: false, decimals };
  try {
    const hex = await buildSigned();
    const sim = await network.simulateGas(hex);
    if (!sim.success) return { state: 'fail', error: sim.error ?? 'Simulation failed' };
    if (sim.networkFee != null) {
      const d = sim.feeDecimals ?? decimals;
      return { state: 'ok', fee: sim.networkFee * n, exact: true, decimals: d };
    }
    if (sim.gasUsed != null && sim.gasUsed > 0n) {
      return { state: 'ok', fee: feeFromGasForDecimals(sim.gasUsed, decimals) * n, exact: true, decimals };
    }
    return { state: 'ok', fee: defaultTxFee(decimals) * n, exact: false, decimals };
  } catch (e) {
    return { state: 'fail', error: e instanceof Error ? e.message : String(e) };
  }
}

export function feeLabel(est: FeeEstimate | null): string {
  if (!est) return 'Estimating…';
  if (est.state === 'fail') return 'Unavailable';
  return `${est.exact ? '' : '≈ '}${formatNative(est.fee, est.decimals)} BOING`;
}
