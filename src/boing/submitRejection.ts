/**
 * Typed `boing_submitTransaction` rejections (RPC-API-SPEC.md "Rejection shapes").
 *
 * The node reports why it refused a transaction in `error.data.reason`; clients must branch on that,
 * not on the message text. Older nodes only send a message, so a few message patterns are mapped to the
 * same reasons as a fallback. Operator methods are never involved here.
 */

import { RpcClientError } from './rpc';
import { formatNative } from './nativeUnit';

export type RejectionReason =
  | 'already_in_mempool'
  | 'unknown_sender'
  | 'stale_nonce'
  | 'insufficient_fee'
  | 'free_pending_limit'
  | 'free_tx_balance_gate'
  | 'native_value_not_active'
  | 'pool_full'
  | 'deployer_cap'
  | 'other';

export interface Rejection {
  reason: RejectionReason;
  /** JSON-RPC error code, when the node sent one. */
  code?: number;
  /** `stale_nonce`: the nonce the account is at now / the one the tx carried. */
  expectedNonce?: bigint;
  gotNonce?: bigint;
  /** `insufficient_fee` / `free_tx_balance_gate`: balance and requirement in ledger base units. */
  have?: bigint;
  need?: bigint;
  /** `already_in_mempool` (and QA pool): the pending tx id. */
  txHash?: string;
  /** `native_value_not_active`: first height at which native value is accepted. */
  activeFrom?: number;
  limit?: number;
  /** Raw node message, for logs / dApps. Never the primary UI text. */
  message?: string;
}

const KNOWN: ReadonlySet<string> = new Set<RejectionReason>([
  'already_in_mempool',
  'unknown_sender',
  'stale_nonce',
  'insufficient_fee',
  'free_pending_limit',
  'free_tx_balance_gate',
  'native_value_not_active',
  'pool_full',
  'deployer_cap',
]);

function big(v: unknown): bigint | undefined {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return BigInt(v.trim());
  return undefined;
}

function fromData(data: unknown, code: number | undefined, message: string | undefined): Rejection | null {
  if (data == null || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const reason = typeof d.reason === 'string' ? d.reason : undefined;
  if (!reason) return null;
  const r: Rejection = { reason: (KNOWN.has(reason) ? reason : 'other') as RejectionReason, code, message };
  r.expectedNonce = big(d.expected_nonce);
  r.gotNonce = big(d.got_nonce);
  r.have = big(d.have);
  r.need = big(d.need);
  if (typeof d.tx_hash === 'string') r.txHash = d.tx_hash;
  const af = big(d.active_from);
  if (af != null) r.activeFrom = Number(af);
  const lim = big(d.limit);
  if (lim != null) r.limit = Number(lim);
  return r;
}

/** Message patterns of nodes that predate `data.reason` (mempool.rs). */
export function rejectionFromMessage(message: string): Rejection | null {
  const m = message ?? '';
  const nonce = /invalid nonce: expected (\d+), got (\d+)/i.exec(m);
  if (nonce) {
    const expected = BigInt(nonce[1]);
    const got = BigInt(nonce[2]);
    // A *future* nonce is admitted and waits in the sender's queue, so only a lower nonce is "stale".
    if (got < expected) return { reason: 'stale_nonce', expectedNonce: expected, gotNonce: got, message: m };
    return null;
  }
  const fee = /insufficient balance for fee: have (\d+), need (\d+)/i.exec(m);
  if (fee) return { reason: 'insufficient_fee', have: BigInt(fee[1]), need: BigInt(fee[2]), message: m };
  if (/duplicate transaction/i.test(m)) return { reason: 'already_in_mempool', message: m };
  if (/unknown sender|sender (account )?(not found|does not exist)|account not found/i.test(m)) {
    return { reason: 'unknown_sender', message: m };
  }
  return null;
}

/** Only the structured form: `error.data.reason` from the node (no message guessing). */
export function rejectionFromRpcData(err: unknown): Rejection | null {
  return err instanceof RpcClientError ? fromData(err.data, err.code, err.message) : null;
}

/** Classify any error thrown while submitting. Prefers `error.data.reason`; falls back to the message. */
export function rejectionFromError(err: unknown): Rejection | null {
  if (err instanceof RpcClientError) {
    return fromData(err.data, err.code, err.message) ?? rejectionFromMessage(err.message);
  }
  if (err instanceof Error) return rejectionFromMessage(err.message);
  if (typeof err === 'string') return rejectionFromMessage(err);
  return null;
}

export interface DescribeRejectionOptions {
  /** Ledger decimals used to show `have` / `need` (spec: base units, so 18). */
  decimals?: number;
  /** Testnet accounts can use the faucet. */
  testnet?: boolean;
}

/** `have` / `need` as BOING with 18 decimals trimmed to a readable length, e.g. "0.00021". */
export function formatBaseUnitsAsBoing(v: bigint, decimals = 18): string {
  return formatNative(v, decimals, 8);
}

/** Plain-language, actionable text for a rejection. */
export function describeRejection(r: Rejection, opts: DescribeRejectionOptions = {}): string {
  const decimals = opts.decimals ?? 18;
  switch (r.reason) {
    case 'unknown_sender':
      return opts.testnet
        ? "This account doesn't hold any BOING yet, so it can't send. Fund it first: use the faucet, or receive BOING from another account, then try again."
        : "This account doesn't hold any BOING yet, so it can't send. Receive some BOING from another account first, then try again.";
    case 'stale_nonce':
      return 'Another transaction from this account was just confirmed, so this one was out of date. Review and send again.';
    case 'insufficient_fee': {
      if (r.have != null && r.need != null) {
        const short = r.need > r.have ? r.need - r.have : 0n;
        return `Your balance is ${formatBaseUnitsAsBoing(r.have, decimals)} BOING, but the network needs ${formatBaseUnitsAsBoing(r.need, decimals)} BOING to cover the fee (network fee plus any priority tip)${short > 0n ? ` (${formatBaseUnitsAsBoing(short, decimals)} BOING short)` : ''}. Add funds or send a smaller amount${opts.testnet ? ', or use the faucet' : ''}.`;
      }
      return 'Your balance is too low to cover the network fee. Add funds or send a smaller amount.';
    }
    case 'already_in_mempool':
      return 'This transaction was already submitted and is waiting to be included. No need to send it again.';
    case 'free_pending_limit':
      return 'You have too many zero-tip transactions waiting. Wait for them to confirm, or add a priority tip and send again.';
    case 'free_tx_balance_gate':
      return r.have != null && r.need != null
        ? `Zero-tip sends need a balance of at least ${formatBaseUnitsAsBoing(r.need, decimals)} BOING (you have ${formatBaseUnitsAsBoing(r.have, decimals)} BOING). Add funds or add a priority tip.`
        : 'Your balance is too low to send a zero-tip transaction. Add a little BOING or a priority tip and try again.';
    case 'native_value_not_active':
      return r.activeFrom != null
        ? `Sending BOING with a contract call starts at block ${r.activeFrom}. Try again once the network reaches it.`
        : 'Sending BOING with a contract call is not active on this network yet.';
    case 'pool_full':
    case 'deployer_cap':
      return r.reason === 'pool_full'
        ? 'The community review (QA) pool is full. Try again later.'
        : 'You have reached the limit of deployments waiting in the community review (QA) pool.';
    default:
      return r.message?.trim() || 'The network rejected this transaction.';
  }
}