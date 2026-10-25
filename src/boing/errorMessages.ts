/**
 * Plain-language explanations for node / RPC / signing failures shown to end users.
 *
 * The raw node message and JSON-RPC code are always preserved for dApps (see `data.boingCode` /
 * `data.rpc` in the provider error contract); this module only decides what the *wallet UI* shows.
 * Node message patterns come from boing.network (`mempool.rs`, `vm.rs`, `signature.rs`) and
 * docs/BOING-RPC-ERROR-CODES-FOR-DAPPS.md.
 */

import { RpcClientError } from './rpc';
import { describeRejection, rejectionFromRpcData } from './submitRejection';

/** Pattern -> friendly text. First match wins; patterns are matched case-insensitively against the node message. */
const MESSAGE_PATTERNS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [
    /insufficient balance for fee: have (\d+), need (\d+)/i,
    () => 'Your balance is too low to cover the network fee. Add funds or send a smaller amount.',
  ],
  [/insufficient balance/i, () => 'Your balance is too low for this transaction (amount plus network fee).'],
  [
    /invalid nonce: expected (\d+), got (\d+)/i,
    () => 'Another transaction from this account is still being processed. Wait a moment and try again.',
  ],
  [
    /legacy .*signature rejected/i,
    () => 'This network requires chain-bound signatures. Update Boing Express and try again.',
  ],
  [/invalid (transaction )?signature/i, () => 'The network rejected the signature. Make sure you are on the right network and account.'],
  [/duplicate transaction/i, () => 'This transaction was already submitted. Check your activity before sending again.'],
  [/mempool full/i, () => 'The network is busy right now. Try again in a minute.'],
  [/free tx rejected/i, () => 'Your balance is too low to send a zero-fee transaction. Add a little BOING and try again.'],
  [/out of gas/i, () => 'The transaction ran out of gas. A larger access list or a different call may be needed.'],
  [/execution window expired/i, () => 'The transaction took too long and expired. Try again.'],
];

const CODE_TEXT: Record<number, string> = {
  [-32700]: 'The network could not read the request. Update Boing Express and try again.',
  [-32600]: 'The network rejected the request format. Update Boing Express and try again.',
  [-32601]: 'This network node does not support that feature yet.',
  [-32602]: 'The network rejected one of the transaction fields. Check the address and amount.',
  [-32603]: 'The network node hit an internal error. Try again shortly.',
  [-32016]: 'The faucet is rate-limited for this account. Wait about a minute and try again.',
  [-32051]: 'This deployment was sent to the community review pool and is waiting for votes.',
  [-32052]: 'No pending review item was found for this transaction.',
  [-32053]: 'This account is not eligible to vote on that review item (not a pool member, its own deployment, or stake below the minimum).',
  [-32054]: 'Community review is currently turned off by governance.',
  [-32055]: 'The community review (QA) pool is full. Try again later.',
  [-32056]: 'You have reached the limit of deployments waiting in the community review (QA) pool.',
  [-32057]: 'This RPC requires operator access.',
};

function qaDetails(data: unknown): { ruleId?: string; message?: string; txHash?: string } {
  if (data == null || typeof data !== 'object') return {};
  const d = data as Record<string, unknown>;
  return {
    ruleId: typeof d.rule_id === 'string' ? d.rule_id : undefined,
    message: typeof d.message === 'string' ? d.message : undefined,
    txHash: typeof d.tx_hash === 'string' ? d.tx_hash : undefined,
  };
}

/**
 * Describe an error for end users. Returns a short, actionable sentence; never exposes stack traces.
 * Unknown node messages are passed through (they are already human readable in most cases).
 */
export function describeWalletError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const code = err instanceof RpcClientError ? err.code : undefined;
  const data = err instanceof RpcClientError ? err.data : undefined;

  // Node-sent \error.data.reason\ wins over message text (RPC-API-SPEC rejection shapes).
  const rejection = rejectionFromRpcData(err);
  if (rejection && rejection.reason !== 'other') return describeRejection(rejection);

  if (code === -32050) {
    const q = qaDetails(data);
    const why = q.message ?? (raw && raw !== 'Server error' ? raw : '');
    return `The network's quality checks rejected this contract${q.ruleId ? ` (rule ${q.ruleId})` : ''}.${why ? ` ${why}` : ''}`.trim();
  }
  if (code === -32051) {
    const q = qaDetails(data);
    return `${CODE_TEXT[-32051]}${q.txHash ? ` Reference: ${q.txHash}` : ''}`;
  }

  for (const [re, text] of MESSAGE_PATTERNS) {
    const m = re.exec(raw);
    if (m) return text(m);
  }
  if (code !== undefined && CODE_TEXT[code]) return CODE_TEXT[code];
  if (/abort|timed out/i.test(raw)) return 'The network took too long to respond. Check your connection and try again.';
  if (/failed to fetch|networkerror|load failed/i.test(raw)) return 'Could not reach the network. Check your connection and try again.';
  return raw || 'Something went wrong. Please try again.';
}