import { feeFromGas } from './bulkTransfer';
import type { NetworkAdapter } from '../networks/types';

export type FeeEstimate =
  | { state: 'ok'; fee: bigint; exact: boolean }
  | { state: 'fail'; error: string };

/** Fee of a plain transfer when the node reports no gas (21 000 gas = 1 BOING). */
export const DEFAULT_TX_FEE = 1n;

/**
 * Simulate the exact signed tx(s) the user is about to send (`boing_simulateTransaction`) and turn gas into a BOING
 * fee. `count` multiplies a per-tx fee (NFT multi-select sends one tx per item). Nothing is broadcast.
 */
export async function estimateSendFee(
  network: NetworkAdapter,
  buildSigned: () => Promise<string>,
  count = 1
): Promise<FeeEstimate> {
  const n = BigInt(Math.max(1, count));
  if (!network.simulateGas) return { state: 'ok', fee: DEFAULT_TX_FEE * n, exact: false };
  try {
    const hex = await buildSigned();
    const sim = await network.simulateGas(hex);
    if (!sim.success) return { state: 'fail', error: sim.error ?? 'Simulation failed' };
    if (sim.gasUsed != null && sim.gasUsed > 0n) return { state: 'ok', fee: feeFromGas(sim.gasUsed) * n, exact: true };
    return { state: 'ok', fee: DEFAULT_TX_FEE * n, exact: false };
  } catch (e) {
    return { state: 'fail', error: e instanceof Error ? e.message : String(e) };
  }
}

export function feeLabel(est: FeeEstimate | null): string {
  if (!est) return 'Estimating…';
  if (est.state === 'fail') return 'Unavailable';
  return `${est.exact ? '' : '≈ '}${est.fee.toString()} BOING`;
}
