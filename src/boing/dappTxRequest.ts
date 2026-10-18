/**
 * Parse dApp JSON transaction requests (boing_signTransaction / boing_sendTransaction).
 */

import { namePayloadSummary, rentFor } from './names';
import { BOING_BASE_DECIMALS, formatNative } from './nativeUnit';
import type { AccountId, AccessList, BatchCall, Payload, Transaction } from './types';
import { accountIdFromHex, accountIdToHex, formatAddress, MAX_BATCH_CALLS } from './types';
import { emptyAccessList, suggestedAccessList } from './accessList';
import { parseReferenceMintBatchTokenIds } from './referenceNft';

const U128_MAX = (1n << 128n) - 1n;

/** Must match boing_qa::VALID_PURPOSE_CATEGORIES (case-insensitive). */
const QA_PURPOSE_ALLOWED = new Set([
  'dapp',
  'token',
  'nft',
  'meme',
  'community',
  'entertainment',
  'tooling',
  'other',
]);

export function assertValidQaPurposeCategory(purpose: string): void {
  const k = purpose.trim().toLowerCase();
  if (!QA_PURPOSE_ALLOWED.has(k)) {
    throw new Error(
      `Invalid purpose_category for Boing protocol QA. Use one of: ${[...QA_PURPOSE_ALLOWED].join(', ')}`
    );
  }
}

function parseAccountIdArray(v: unknown, label: string): AccountId[] {
  if (v == null) return [];
  if (!Array.isArray(v)) {
    throw new Error(`${label} must be an array of 64-character hex account ids`);
  }
  return v.map((item, i) => {
    try {
      return accountIdFromHex(String(item ?? ''));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`${label}[${i}]: ${msg}`);
    }
  });
}

/** Parse `access_list` / `accessList` from dApp JSON (Boing 32-byte accounts, optional 0x). */
export function accessListFromDappJson(raw: unknown, fieldName = 'access_list'): AccessList {
  if (raw == null) return emptyAccessList();
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${fieldName} must be an object with read and write arrays`);
  }
  const o = raw as Record<string, unknown>;
  const readRaw = o.read ?? o.Read;
  const writeRaw = o.write ?? o.Write;
  return {
    read: parseAccountIdArray(readRaw, `${fieldName}.read`),
    write: parseAccountIdArray(writeRaw, `${fieldName}.write`),
  };
}

/** Decode reference NFT `mint_batch` (selector `0x06`) for wallet preview. Access lists stay AccountIds. */
export function describeReferenceMintBatchCalldata(
  calldata: Uint8Array
): { n: number; to: AccountId; tokenIds: string[] } | null {
  const parsed = parseReferenceMintBatchTokenIds(calldata);
  if (!parsed) return null;
  return {
    n: parsed.n,
    to: accountIdFromHex(parsed.toHex),
    tokenIds: parsed.tokenIds,
  };
}

function parseU128String(s: unknown, field: string): bigint {
  if (s === undefined || s === null) throw new Error(`${field} is required`);
  const str = String(s).trim();
  if (!/^\d+$/.test(str)) throw new Error(`${field} must be a decimal u128 string`);
  const v = BigInt(str);
  if (v < 0n || v > U128_MAX) throw new Error(`${field} out of u128 range`);
  return v;
}

/**
 * Optional native value of a contract call (`value`, decimal base units; 1 BOING = 10^18). `0` or absent = none.
 * Nodes accept non-zero values from the native-value activation height (testnet 1150).
 */
function parseOptionalValue(s: unknown, field: string): bigint | undefined {
  if (s === undefined || s === null || s === '') return undefined;
  const v = parseU128String(s, field);
  return v > 0n ? v : undefined;
}

/** Native BOING a payload sends to contracts (sum of `value` fields). */
export function payloadCallValue(p: Payload): bigint {
  if (p.kind === 'contract_call') return p.value ?? 0n;
  if (p.kind === 'batch') return p.calls.reduce((a, c) => (c.kind === 'contract_call' ? a + (c.value ?? 0n) : a), 0n);
  return 0n;
}

function parseNonce(s: unknown): bigint | null {
  if (s === undefined || s === null || s === '') return null;
  const str = String(s).trim();
  if (!/^\d+$/.test(str)) throw new Error('nonce must be a decimal u64 string');
  const v = BigInt(str);
  if (v < 0n || v > 0xffff_ffff_ffff_ffffn) throw new Error('nonce out of u64 range');
  return v;
}

function hexToBytesFlexible(hex: string, field: string): Uint8Array {
  const h = hex.replace(/^0x/i, '');
  if (h.length % 2 !== 0) throw new Error(`${field}: invalid hex length`);
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error(`${field}: invalid hex`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** `Option<[u8; 32]>` CREATE2 salt from dApp JSON (`create2_salt` / `create2Salt`, 64 hex chars). */
function parseCreate2Salt(o: Record<string, unknown>): Uint8Array | null {
  const c2 = o.create2_salt ?? o.create2Salt;
  if (c2 == null || c2 === '') return null;
  const bytes = hexToBytesFlexible(String(c2), 'create2_salt');
  if (bytes.length !== 32) {
    throw new Error('create2_salt must be 32 bytes (64 hex characters)');
  }
  return bytes;
}

export type BoingDappTxRequestJson = Record<string, unknown>;

/**
 * `true` when `calldata` is a reference-style `transfer(to, amount)` (selector `0x01`, 96 bytes — reference
 * fungible, secured fungible, LP share token) sent to the signer itself. On v1 of those templates a
 * self-transfer credits without debiting (balance doubling, known bug); on v2 it is a no-op.
 */
export function isReferenceSelfTransferCalldata(sender: AccountId, calldata: Uint8Array): boolean {
  if (calldata.length !== 96) return false;
  for (let i = 0; i < 31; i++) if (calldata[i] !== 0) return false;
  if (calldata[31] !== 0x01) return false;
  for (let i = 0; i < 32; i++) if (calldata[32 + i] !== sender[i]) return false;
  return true;
}

export const SELF_TRANSFER_REFUSED =
  'Refusing token transfer to your own address: v1 Boing reference tokens double the balance on self-transfer (known bug). Send to a different address.';

/**
 * How native BOING amounts in a request are read. `decimals`: ledger decimals of the block the tx will land in
 * (18 = base units, from the redenomination height on; 0 = whole BOING before it). New txs are base units, so the
 * default is 18. `fee`: the estimated network fee, if the caller simulated the tx.
 */
export type NativeAmountContext = {
  decimals?: number;
  fee?: { amount: bigint; decimals: number; exact: boolean } | null;
};

function ctxDecimals(ctx?: NativeAmountContext): number {
  const d = ctx?.decimals;
  return d != null && Number.isFinite(d) && d >= 0 ? d : BOING_BASE_DECIMALS;
}

/** Exact native amount as BOING (all fraction digits kept, trailing zeros trimmed), e.g. `20 BOING`. */
export function formatNativeBoing(raw: bigint, decimals: number): string {
  return `${formatNative(raw, decimals, Math.max(decimals, 0))} BOING`;
}

function nativeAmountRows(label: string, raw: bigint, decimals: number): { label: string; value: string }[] {
  const rows = [{ label, value: formatNativeBoing(raw, decimals) }];
  if (decimals > 0) rows.push({ label: `${label} (base units)`, value: raw.toString() });
  return rows;
}

function batchStepLine(c: BatchCall, decimals: number = BOING_BASE_DECIMALS): string {
  if (c.kind === 'transfer') return `Transfer ${formatNativeBoing(c.amount, decimals)} to ${formatAddress(c.to, true)}`;
  const mint = describeReferenceMintBatchCalldata(c.calldata);
  if (mint) return `Mint ${mint.n} NFTs to ${formatAddress(mint.to, true)} (contract ${formatAddress(c.contract, true)})`;
  const v = c.value != null && c.value > 0n ? ` sending ${formatNativeBoing(c.value, decimals)}` : '';
  return `Call contract ${formatAddress(c.contract, true)}${v} | calldata ${c.calldata.length} bytes`;
}

/** Parse `calls` / `steps` of a dApp `batch` request (each `{ type: 'transfer' | 'contract_call', ... }`). */
export function batchCallsFromDappJson(raw: unknown, sender: AccountId): BatchCall[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('batch requires a non-empty calls array');
  if (raw.length > MAX_BATCH_CALLS) throw new Error(`batch has ${raw.length} steps; max is ${MAX_BATCH_CALLS}`);
  return raw.map((s, i) => {
    if (!s || typeof s !== 'object') throw new Error(`batch step ${i + 1} must be an object`);
    const o = s as BoingDappTxRequestJson;
    const t = String(o.type ?? o.kind ?? '');
    if (t === 'transfer') {
      return { kind: 'transfer', to: accountIdFromHex(String(o.to ?? '')), amount: parseU128String(o.amount, `calls[${i}].amount`) };
    }
    if (t === 'contract_call' || t === 'contractCall') {
      const contract = accountIdFromHex(String(o.contract ?? ''));
      const calldata = hexToBytesFlexible(String(o.calldata ?? '0x'), `calls[${i}].calldata`);
      if (isReferenceSelfTransferCalldata(sender, calldata)) throw new Error(SELF_TRANSFER_REFUSED);
      const value = parseOptionalValue(o.value, `calls[${i}].value`);
      return value != null ? { kind: 'contract_call', contract, calldata, value } : { kind: 'contract_call', contract, calldata };
    }
    throw new Error(`batch step ${i + 1}: type must be transfer or contract_call`);
  });
}

export function transactionSummary(tx: Transaction, ctx?: NativeAmountContext): string {
  const d = ctxDecimals(ctx);
  const from = formatAddress(tx.sender, true);
  const n = tx.nonce.toString();
  const p = tx.payload;
  switch (p.kind) {
    case 'transfer':
      return `Boing tx | From ${from} | Nonce ${n} | Transfer ${formatNativeBoing(p.amount, d)} to ${formatAddress(p.to, true)}`;
    case 'bond':
      return `Boing tx | From ${from} | Nonce ${n} | Bond ${formatNativeBoing(p.amount, d)} stake`;
    case 'unbond':
      return `Boing tx | From ${from} | Nonce ${n} | Unbond ${formatNativeBoing(p.amount, d)} stake`;
    case 'claim_unbond':
      return `Boing tx | From ${from} | Nonce ${n} | Claim unbonded stake`;
    case 'qa_pool_vote':
      return `Boing tx | From ${from} | Nonce ${n} | QA pool vote ${p.vote} on ${formatAddress(p.subject, true)}`;
    case 'contract_call': {
      const mint = describeReferenceMintBatchCalldata(p.calldata);
      const ar = tx.access_list.read.length;
      const aw = tx.access_list.write.length;
      const al = ar + aw > 0 ? ` | access_list read:${ar} write:${aw}` : '';
      if (mint) {
        return `Boing tx | From ${from} | Nonce ${n} | Mint ${mint.n} NFTs to ${formatAddress(mint.to, true)}${al}`;
      }
      const v = p.value != null && p.value > 0n ? ` | sending ${formatNativeBoing(p.value, d)}` : '';
      return `Boing tx | From ${from} | Nonce ${n} | Call contract ${formatAddress(p.contract, true)}${v} | calldata ${p.calldata.length} bytes${al}`;
    }
    case 'contract_deploy':
      return `Boing tx | From ${from} | Nonce ${n} | Deploy contract | bytecode ${p.bytecode.length} bytes`;
    case 'contract_deploy_purpose':
      return `Boing tx | From ${from} | Nonce ${n} | Deploy (purpose: ${p.purpose_category}) | bytecode ${p.bytecode.length} bytes${
        p.create2_salt ? ' | CREATE2' : ''
      }`;
    case 'contract_deploy_meta':
      return `Boing tx | From ${from} | Nonce ${n} | Deploy + metadata (${p.purpose_category}) | bytecode ${p.bytecode.length} bytes${
        p.create2_salt ? ' | CREATE2' : ''
      }`;
    case 'validator_register':
      return `Boing tx | From ${from} | Nonce ${n} | Register validator node ${formatAddress(p.node_id, true)}`;
    case 'validator_deregister':
      return `Boing tx | From ${from} | Nonce ${n} | Deregister validator node ${formatAddress(p.node_id, true)}`;
    case 'validator_unjail':
      return `Boing tx | From ${from} | Nonce ${n} | Unjail validator node ${formatAddress(p.node_id, true)}`;
    case 'batch':
      return `Boing tx | From ${from} | Nonce ${n} | Batch of ${p.calls.length} steps (one signature, atomic): ${p.calls
        .map((c) => batchStepLine(c, d))
        .join('; ')}`;
    case 'name_commit':
    case 'name_register':
    case 'name_renew':
    case 'name_transfer':
    case 'name_set_target':
    case 'name_set_primary':
    case 'name_release':
      return `Boing tx | From ${from} | Nonce ${n} | ${namePayloadSummary(p)}${
        p.kind === 'name_register' || p.kind === 'name_renew' ? ` | rent ${rentFor(p.name, p.years).toString()} BOING (burned)` : ''
      }`;
    default: {
      const _e: never = p;
      return _e;
    }
  }
}

/** Structured rows for the extension signature approval window (richer than plain `transactionSummary`). */
export type TransactionApprovalDetail = {
  txType: string;
  summaryLine: string;
  rows: { label: string; value: string }[];
};

function hexPreview(bytes: Uint8Array, maxBytes = 24): string {
  if (bytes.length === 0) return '(empty)';
  const n = Math.min(maxBytes, bytes.length);
  const h = Array.from(bytes.subarray(0, n))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return bytes.length > n ? `0x${h}… (${bytes.length} bytes total)` : `0x${h}`;
}

function accessListSummary(tx: Transaction): { label: string; value: string } {
  const { read, write } = tx.access_list;
  const parts: string[] = [];
  if (read.length) parts.push(`${read.length} read`);
  if (write.length) parts.push(`${write.length} write`);
  const counts = parts.length ? parts.join(' · ') : 'empty';
  const preview = (accounts: AccountId[]): string =>
    accounts.length === 0
      ? '—'
      : accounts
          .slice(0, 3)
          .map((a) => `${formatAddress(a, true).slice(0, 10)}…`)
          .join(', ') + (accounts.length > 3 ? ` (+${accounts.length - 3} more)` : '');
  return {
    label: 'Access list',
    value: `${counts}\nRead: ${preview(read)}\nWrite: ${preview(write)}`,
  };
}

/**
 * Human-readable breakdown for the approval popup (transaction signing / send).
 */
export function buildTransactionApprovalDetail(tx: Transaction, ctx?: NativeAmountContext): TransactionApprovalDetail {
  const d = ctxDecimals(ctx);
  const from = formatAddress(tx.sender, true);
  const rows: { label: string; value: string }[] = [
    { label: 'From', value: from },
    { label: 'Nonce', value: tx.nonce.toString() },
  ];
  const p = tx.payload;
  switch (p.kind) {
    case 'transfer':
      rows.push({ label: 'Operation', value: 'Transfer' });
      rows.push({ label: 'To', value: formatAddress(p.to, true) });
      rows.push(...nativeAmountRows('Amount', p.amount, d));
      if (tx.access_list.read.length + tx.access_list.write.length > 0) {
        rows.push(accessListSummary(tx));
      }
      break;
    case 'bond':
      rows.push({ label: 'Operation', value: 'Bond (stake)' });
      rows.push(...nativeAmountRows('Amount', p.amount, d));
      if (tx.access_list.read.length + tx.access_list.write.length > 0) {
        rows.push(accessListSummary(tx));
      }
      break;
    case 'unbond':
      rows.push({ label: 'Operation', value: 'Unbond' });
      rows.push(...nativeAmountRows('Amount', p.amount, d));
      if (tx.access_list.read.length + tx.access_list.write.length > 0) {
        rows.push(accessListSummary(tx));
      }
      break;
    case 'claim_unbond':
      rows.push({ label: 'Operation', value: 'Claim unbond' });
      rows.push({
        label: 'Effect',
        value: 'Move matured pending_unbond into spendable balance',
      });
      if (tx.access_list.read.length + tx.access_list.write.length > 0) {
        rows.push(accessListSummary(tx));
      }
      break;
    case 'qa_pool_vote':
      rows.push({ label: 'Operation', value: 'QA pool vote' });
      rows.push({ label: 'Subject', value: formatAddress(p.subject, true) });
      rows.push({
        label: 'Vote',
        value: p.vote === 'allow' ? 'Allow' : p.vote === 'reject' ? 'Reject' : 'Abstain',
      });
      rows.push({
        label: 'Rewards',
        value:
          p.vote === 'abstain'
            ? 'Abstain does not earn the counted-vote treasury reward by default'
            : 'Counted Allow/Reject votes are paid from PROTOCOL_TREASURY when the vote is included',
      });
      if (tx.access_list.read.length + tx.access_list.write.length > 0) {
        rows.push(accessListSummary(tx));
      }
      break;
    case 'contract_call': {
      const mint = describeReferenceMintBatchCalldata(p.calldata);
      rows.push({
        label: 'Operation',
        value: mint ? `Mint ${mint.n} NFTs to ${formatAddress(mint.to, true)}` : 'Contract call',
      });
      rows.push({ label: 'Contract', value: formatAddress(p.contract, true) });
      if (p.value != null && p.value > 0n) rows.push(...nativeAmountRows('BOING sent to contract', p.value, d));
      if (mint) {
        rows.push({ label: 'Recipient', value: formatAddress(mint.to, true) });
        rows.push({ label: 'Count', value: String(mint.n) });
      }
      rows.push({ label: 'Calldata', value: `${p.calldata.length} bytes — ${hexPreview(p.calldata)}` });
      rows.push(accessListSummary(tx));
      break;
    }
    case 'contract_deploy':
      rows.push({ label: 'Operation', value: 'Deploy (legacy)' });
      rows.push({ label: 'Bytecode', value: `${p.bytecode.length} bytes — ${hexPreview(p.bytecode)}` });
      rows.push(accessListSummary(tx));
      break;
    case 'contract_deploy_purpose':
      rows.push({ label: 'Operation', value: 'Deploy (purpose)' });
      rows.push({ label: 'Purpose', value: p.purpose_category });
      if (p.description_hash) {
        rows.push({ label: 'Description hash', value: hexPreview(p.description_hash) });
      }
      if (p.create2_salt) {
        rows.push({ label: 'CREATE2 salt', value: hexPreview(p.create2_salt, 32) });
      }
      rows.push({ label: 'Bytecode', value: `${p.bytecode.length} bytes — ${hexPreview(p.bytecode)}` });
      rows.push(accessListSummary(tx));
      break;
    case 'contract_deploy_meta':
      rows.push({ label: 'Operation', value: 'Deploy + metadata' });
      rows.push({ label: 'Purpose', value: p.purpose_category });
      if (p.asset_name != null || p.asset_symbol != null) {
        rows.push({
          label: 'Asset',
          value: [p.asset_name, p.asset_symbol].filter(Boolean).join(' ') || '—',
        });
      }
      if (p.description_hash) {
        rows.push({ label: 'Description hash', value: hexPreview(p.description_hash) });
      }
      if (p.create2_salt) {
        rows.push({ label: 'CREATE2 salt', value: hexPreview(p.create2_salt, 32) });
      }
      rows.push({ label: 'Bytecode', value: `${p.bytecode.length} bytes — ${hexPreview(p.bytecode)}` });
      rows.push(accessListSummary(tx));
      break;
    case 'batch':
      rows.push({ label: 'Operation', value: `Batch: ${p.calls.length} steps in one transaction (all succeed or all revert)` });
      p.calls.forEach((c, i) => {
        rows.push({ label: `Step ${i + 1}`, value: batchStepLine(c, d) });
      });
      {
        const total = p.calls.reduce((acc, c) => (c.kind === 'transfer' ? acc + c.amount : acc), 0n);
        if (p.calls.some((c) => c.kind === 'transfer')) rows.push(...nativeAmountRows('Total transferred', total, d));
        const sent = payloadCallValue(p);
        if (sent > 0n) rows.push(...nativeAmountRows('BOING sent to contracts', sent, d));
      }
      rows.push(accessListSummary(tx));
      break;
    case 'validator_register':
    case 'validator_deregister':
    case 'validator_unjail':
      rows.push({
        label: 'Operation',
        value:
          p.kind === 'validator_register'
            ? 'Register validator (locks bond)'
            : p.kind === 'validator_deregister'
              ? 'Deregister validator'
              : 'Unjail validator',
      });
      rows.push({ label: 'Node', value: formatAddress(p.node_id, true) });
      rows.push(accessListSummary(tx));
      break;
    case 'name_commit':
    case 'name_register':
    case 'name_renew':
    case 'name_transfer':
    case 'name_set_target':
    case 'name_set_primary':
    case 'name_release':
      rows.push({ label: 'Operation', value: namePayloadSummary(p) ?? p.kind });
      if (p.kind === 'name_register' || p.kind === 'name_renew') {
        rows.push({ label: 'Rent (burned)', value: `${rentFor(p.name, p.years).toString()} BOING` });
      }
      rows.push(accessListSummary(tx));
      break;
    default: {
      const _ex: never = p;
      return _ex;
    }
  }

  if (ctx?.fee) {
    rows.push({
      label: 'Network fee',
      value: `${ctx.fee.exact ? '' : '≈ '}${formatNative(ctx.fee.amount, ctx.fee.decimals)} BOING`,
    });
  }

  return {
    txType: p.kind,
    summaryLine: transactionSummary(tx, ctx),
    rows,
  };
}

/**
 * Build unsigned Transaction from dApp JSON. Caller supplies sender + nonce resolution.
 */
export function transactionFromDappJson(
  raw: unknown,
  sender: AccountId,
  nonce: bigint
): Transaction {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Transaction request must be a JSON object');
  }
  const o = raw as BoingDappTxRequestJson;
  const type = o.type ?? o.txType;
  if (typeof type !== 'string') {
    throw new Error('Missing type (e.g. transfer, contract_deploy)');
  }

  let payload: Payload;

  switch (type) {
    case 'transfer': {
      const to = accountIdFromHex(String(o.to ?? ''));
      const amount = parseU128String(o.amount, 'amount');
      payload = { kind: 'transfer', to, amount };
      break;
    }
    case 'bond': {
      payload = { kind: 'bond', amount: parseU128String(o.amount, 'amount') };
      break;
    }
    case 'unbond': {
      payload = { kind: 'unbond', amount: parseU128String(o.amount, 'amount') };
      break;
    }
    case 'claim_unbond':
    case 'claimUnbond': {
      payload = { kind: 'claim_unbond' };
      break;
    }
    case 'qa_pool_vote':
    case 'qaPoolVote': {
      const subject = accountIdFromHex(String(o.subject ?? o.txHash ?? o.tx_hash ?? ''));
      const voteRaw = String(o.vote ?? '').trim().toLowerCase();
      if (voteRaw !== 'allow' && voteRaw !== 'reject' && voteRaw !== 'abstain') {
        throw new Error('qa_pool_vote vote must be allow, reject, or abstain');
      }
      payload = { kind: 'qa_pool_vote', subject, vote: voteRaw };
      break;
    }
    case 'contract_call': {
      const contract = accountIdFromHex(String(o.contract ?? ''));
      const calldata = hexToBytesFlexible(String(o.calldata ?? '0x'), 'calldata');
      if (isReferenceSelfTransferCalldata(sender, calldata)) throw new Error(SELF_TRANSFER_REFUSED);
      const value = parseOptionalValue(o.value, 'value');
      payload = value != null ? { kind: 'contract_call', contract, calldata, value } : { kind: 'contract_call', contract, calldata };
      break;
    }
    case 'contract_deploy': {
      throw new Error(
        'type "contract_deploy" is not accepted from dApps. Use contract_deploy_purpose or contract_deploy_meta with a valid purpose_category (Boing protocol QA).'
      );
    }
    case 'contract_deploy_purpose': {
      const bytecode = hexToBytesFlexible(String(o.bytecode ?? '0x'), 'bytecode');
      const purpose_category = String(o.purpose_category ?? o.purposeCategory ?? '').trim();
      if (!purpose_category) throw new Error('purpose_category is required');
      assertValidQaPurposeCategory(purpose_category);
      let description_hash: Uint8Array | null = null;
      const dh = o.description_hash ?? o.descriptionHash;
      if (dh != null && dh !== '') {
        description_hash = hexToBytesFlexible(String(dh), 'description_hash');
      }
      payload = {
        kind: 'contract_deploy_purpose',
        bytecode,
        purpose_category,
        description_hash,
        create2_salt: parseCreate2Salt(o),
      };
      break;
    }
    case 'contract_deploy_meta': {
      const bytecode = hexToBytesFlexible(String(o.bytecode ?? '0x'), 'bytecode');
      let description_hash: Uint8Array | null = null;
      const dh = o.description_hash ?? o.descriptionHash;
      if (dh != null && dh !== '') {
        description_hash = hexToBytesFlexible(String(dh), 'description_hash');
      }
      const asset_name =
        o.asset_name != null && o.asset_name !== ''
          ? String(o.asset_name)
          : o.assetName != null && o.assetName !== ''
            ? String(o.assetName)
            : null;
      const asset_symbol =
        o.asset_symbol != null && o.asset_symbol !== ''
          ? String(o.asset_symbol)
          : o.assetSymbol != null && o.assetSymbol !== ''
            ? String(o.assetSymbol)
            : null;
      let purpose_category = String(o.purpose_category ?? o.purposeCategory ?? '').trim();
      if (!purpose_category) {
        if (asset_name != null || asset_symbol != null) {
          purpose_category = 'token';
        } else {
          throw new Error(
            'purpose_category is required for contract_deploy_meta (or set asset_name / asset_symbol to default purpose to "token")'
          );
        }
      }
      assertValidQaPurposeCategory(purpose_category);
      payload = {
        kind: 'contract_deploy_meta',
        bytecode,
        purpose_category,
        description_hash,
        asset_name,
        asset_symbol,
        create2_salt: parseCreate2Salt(o),
      };
      break;
    }
    case 'batch': {
      payload = { kind: 'batch', calls: batchCallsFromDappJson(o.calls ?? o.steps, sender) };
      break;
    }
    default:
      throw new Error(`Unsupported transaction type: ${type}`);
  }

  const overrideNonce = parseNonce(o.nonce);
  const finalNonce = overrideNonce !== null ? overrideNonce : nonce;

  const accessListRaw = o.access_list ?? o.accessList;
  const access_list =
    accessListRaw !== undefined && accessListRaw !== null
      ? accessListFromDappJson(accessListRaw)
      : suggestedAccessList(sender, payload);

  return {
    nonce: finalNonce,
    sender,
    payload,
    access_list,
  };
}

export function assertFromMatchesSender(request: unknown, senderHex: string): void {
  if (!request || typeof request !== 'object') return;
  const from = (request as BoingDappTxRequestJson).from;
  if (from === undefined || from === null || from === '') return;
  const want = senderHex.replace(/^0x/i, '').toLowerCase();
  const got = String(from).replace(/^0x/i, '').toLowerCase();
  if (got !== want) {
    throw new Error(`from does not match active account (expected 0x${want})`);
  }
}

export { accountIdToHex };
