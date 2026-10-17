/**
 * On-chain transaction history for the Tx tab (`boing_getAccountTransactions`), merged with the
 * device-local entries (which carry richer summaries and cover still-pending submissions).
 */
import { rpcCall, isMethodNotFoundError } from './rpc';
import type { TxHistoryEntry } from '../storage/txHistory';

export interface ChainTxStep { kind: string; to?: string; amount?: string; contract?: string; calldata_len?: number }

export interface ChainTxRow {
  tx_id: string;
  block_height: number;
  tx_index: number;
  timestamp: number;
  sender: string;
  nonce: number;
  direction: 'in' | 'out';
  payload: { kind: string; to?: string; amount?: string; contract?: string; node_id?: string; steps?: ChainTxStep[] };
  success: boolean | null;
  error: string | null;
}

export interface ChainTxPage { transactions: ChainTxRow[]; next_cursor: string | null; head_height?: number }

export type HistoryStatus = 'confirmed' | 'failed' | 'pending';

export interface DisplayTxEntry {
  txHash: string;
  label: string;
  summary: string;
  steps?: string[];
  timestamp: number;
  blockHeight?: number;
  direction: 'in' | 'out';
  status: HistoryStatus;
  error?: string | null;
  source: 'chain' | 'local' | 'both';
}

const LOCAL_LABEL: Record<TxHistoryEntry['type'], string> = {
  send: 'Send BOING',
  bond: 'Bond',
  unbond: 'Unbond',
  claim_unbond: 'Claim unbond',
  token_send: 'Send token',
  nft_send: 'Send NFT',
  contract_call: 'Contract call',
  batch: 'Batch',
  validator_register: 'Register validator',
  validator_deregister: 'Deregister validator',
  validator_unjail: 'Unjail validator',
};

/** Local entries younger than this that are not on chain yet are shown as pending. */
export const PENDING_WINDOW_MS = 10 * 60 * 1000;

export function normHash(h: string): string {
  const x = h.trim().toLowerCase();
  return x.startsWith('0x') ? x : `0x${x}`;
}

const short = (h?: string) => {
  if (!h) return '?';
  const x = normHash(h);
  return `${x.slice(0, 6)}…${x.slice(-4)}`;
};

export function formatBoingAmount(raw: string | undefined, decimals = 0): string {
  if (raw == null) return '?';
  try {
    const v = BigInt(raw);
    if (decimals <= 0) return v.toLocaleString('en-US');
    const base = 10n ** BigInt(decimals);
    const whole = v / base;
    const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
    return frac ? `${whole.toLocaleString('en-US')}.${frac}` : whole.toLocaleString('en-US');
  } catch {
    return raw;
  }
}

function stepLine(s: ChainTxStep, decimals: number): string {
  if (s.kind === 'transfer') return `${formatBoingAmount(s.amount, decimals)} BOING → ${short(s.to)}`;
  return `Call ${short(s.contract)}`;
}

/** A reverted tx moved nothing except the sender's fee; say so instead of implying the value moved. */
export function failedSummary(attempted: string): string {
  return `Not transferred (failed): ${attempted}. Reverted, only the fee was charged.`;
}

export function chainRowToDisplay(row: ChainTxRow, decimals = 0): DisplayTxEntry {
  const p = row.payload;
  const out = row.direction === 'out';
  let label = 'Transaction';
  let summary = '';
  let steps: string[] | undefined;
  switch (p.kind) {
    case 'transfer':
      label = out ? 'Send BOING' : 'Receive BOING';
      summary = out
        ? `${formatBoingAmount(p.amount, decimals)} BOING → ${short(p.to)}`
        : `${formatBoingAmount(p.amount, decimals)} BOING from ${short(row.sender)}`;
      break;
    case 'contract_call':
      label = out ? 'Contract call' : 'Incoming call';
      summary = out ? `Call ${short(p.contract)}` : `From ${short(row.sender)} via ${short(p.contract)}`;
      break;
    case 'batch':
      label = out ? 'Batch' : 'Batch (incoming)';
      steps = (p.steps ?? []).map((s) => stepLine(s, decimals));
      summary = out ? `${steps.length} steps in one transaction` : `From ${short(row.sender)} (${steps.length} steps)`;
      break;
    case 'contract_deploy':
      label = 'Deploy contract';
      summary = 'Contract deployment';
      break;
    case 'bond':
      label = 'Bond';
      summary = `${formatBoingAmount(p.amount, decimals)} BOING`;
      break;
    case 'unbond':
      label = 'Unbond';
      summary = `${formatBoingAmount(p.amount, decimals)} BOING`;
      break;
    case 'claim_unbond':
      label = 'Claim unbond';
      break;
    case 'validator_register':
      label = 'Register validator';
      summary = `Node ${short(p.node_id)}`;
      break;
    case 'validator_deregister':
      label = 'Deregister validator';
      summary = `Node ${short(p.node_id)}`;
      break;
    case 'validator_unjail':
      label = 'Unjail validator';
      summary = `Node ${short(p.node_id)}`;
      break;
    default:
      label = p.kind.replace(/_/g, ' ');
  }
  const ts = row.timestamp > 0 && row.timestamp < 1e12 ? row.timestamp * 1000 : row.timestamp;
  const failed = row.success === false;
  if (failed) summary = failedSummary(summary || label);
  return {
    txHash: normHash(row.tx_id),
    label,
    summary, // no "Block N" fallback: block info lives in the explorer
    ...(steps && steps.length ? { steps } : {}),
    timestamp: ts,
    blockHeight: row.block_height,
    direction: row.direction,
    status: row.success === false ? 'failed' : 'confirmed',
    error: row.error,
    source: 'chain',
  };
}

/** Merge chain rows with local entries: dedupe by hash, keep local summaries/steps, show unseen recent local txs as pending. */
export function mergeTxHistory(
  local: TxHistoryEntry[],
  chain: DisplayTxEntry[],
  opts: { now?: number; chainLoaded?: boolean } = {}
): DisplayTxEntry[] {
  const now = opts.now ?? Date.now();
  const byHash = new Map<string, DisplayTxEntry>();
  for (const c of chain) byHash.set(c.txHash, c);
  const extra: DisplayTxEntry[] = [];
  for (const l of local) {
    const h = normHash(l.txHash);
    const c = byHash.get(h);
    if (c) {
      byHash.set(h, {
        ...c,
        label: c.direction === 'out' ? LOCAL_LABEL[l.type] ?? c.label : c.label,
        // A failed tx keeps the chain summary ("Not transferred (failed)"), not the optimistic local one.
        summary: c.status === 'failed' ? (l.summary ? failedSummary(l.summary) : c.summary) : l.summary ?? c.summary,
        steps: l.steps && l.steps.length ? l.steps : c.steps,
        source: 'both',
      });
      continue;
    }
    if (extra.some((e) => e.txHash === h)) continue;
    const pending = !opts.chainLoaded || now - l.timestamp < PENDING_WINDOW_MS;
    extra.push({
      txHash: h,
      label: LOCAL_LABEL[l.type] ?? l.type,
      summary: l.summary ?? new Date(l.timestamp).toLocaleString(),
      ...(l.steps && l.steps.length ? { steps: l.steps } : {}),
      timestamp: l.timestamp,
      direction: 'out',
      status: pending ? 'pending' : 'confirmed',
      source: 'local',
    });
  }
  const merged = [...byHash.values(), ...extra];
  merged.sort((a, b) => {
    if ((a.status === 'pending') !== (b.status === 'pending')) return a.status === 'pending' ? -1 : 1;
    if (a.blockHeight != null && b.blockHeight != null && a.blockHeight !== b.blockHeight) return b.blockHeight - a.blockHeight;
    return b.timestamp - a.timestamp;
  });
  return merged;
}

/** One page of chain history. Resolves `null` when the node does not expose the method (older nodes). */
export async function fetchChainTxPage(
  rpcUrl: string,
  accountHex: string,
  cursor: string | null = null,
  limit = 25
): Promise<ChainTxPage | null> {
  const acct = accountHex.startsWith('0x') ? accountHex : `0x${accountHex}`;
  try {
    return await rpcCall<ChainTxPage>(rpcUrl, 'boing_getAccountTransactions', [acct, { cursor, limit }]);
  } catch (e) {
    if (isMethodNotFoundError(e)) return null;
    throw e;
  }
}