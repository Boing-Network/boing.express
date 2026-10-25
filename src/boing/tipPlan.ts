/**
 * Priority-tip plan for dApp approvals (extension approval window + web /sign).
 *
 * The approval screen shows the speed chooser only when it can honestly apply: the node accepts tips
 * (`optional_priority_tips` is not false), the ledger is in 18-decimal base units, and the dApp did not already set a tip
 * (a dApp tip wins and is shown read-only). The plan crosses the extension message boundary as strings (`TipPlanWire`).
 */
import type { NativeAmountContext } from './dappTxRequest';
import { MAX_CUSTOM_TIP } from './feeTips';
import { fetchFeePolicy } from './networkInfo';
import type { Transaction } from './types';

export interface TipPlan {
  /** The chooser applies to this transaction. */
  allowed: boolean;
  /** Tip the dApp set on the transaction (base units); wins over the chooser. */
  locked?: bigint;
  /** Estimated network fee in base units (18 decimals), excluding any tip. */
  fee: bigint | null;
}

export interface TipPlanWire {
  allowed: boolean;
  locked?: string;
  fee?: string;
}

export async function planTip(rpcUrl: string, tx: Transaction, ctx: NativeAmountContext): Promise<TipPlan> {
  const fee = ctx.fee && ctx.fee.decimals >= 18 ? ctx.fee.amount : null;
  if (tx.priorityTip != null && tx.priorityTip > 0n) return { allowed: false, locked: tx.priorityTip, fee };
  if ((ctx.decimals ?? 18) < 18) return { allowed: false, fee };
  const policy = await fetchFeePolicy(rpcUrl);
  return { allowed: policy.tipsAllowed, fee };
}

export function tipPlanToWire(p: TipPlan): TipPlanWire {
  return {
    allowed: p.allowed,
    ...(p.locked != null ? { locked: p.locked.toString() } : {}),
    ...(p.fee != null ? { fee: p.fee.toString() } : {}),
  };
}

export function tipPlanFromWire(w: TipPlanWire | undefined | null): TipPlan {
  const big = (s: unknown): bigint | undefined => (typeof s === 'string' && /^\d+$/.test(s) ? BigInt(s) : undefined);
  return { allowed: w?.allowed === true, locked: big(w?.locked), fee: big(w?.fee) ?? null };
}

/**
 * Apply the user's chosen tip to the transaction. Only when the plan allows it, the dApp set none, and the amount is
 * valid and within the cap; anything else leaves the transaction untouched (never throws on a bad value).
 */
export function applyChosenTip(tx: Transaction, plan: TipPlan, chosen: unknown): Transaction {
  if (!plan.allowed) return tx;
  if (tx.priorityTip != null && tx.priorityTip > 0n) return tx;
  let tip: bigint;
  try {
    tip = typeof chosen === 'bigint' ? chosen : typeof chosen === 'string' && /^\d+$/.test(chosen) ? BigInt(chosen) : 0n;
  } catch {
    return tx;
  }
  if (tip <= 0n || tip > MAX_CUSTOM_TIP) return tx;
  return { ...tx, priorityTip: tip };
}