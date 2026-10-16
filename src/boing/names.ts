/**
 * Boing name registry (`label.boing`) for the wallet: normalization, rent, commit-reveal claim,
 * name management txs, and recipient resolution. Mirrors `boing_primitives::names` on the node.
 */
import { blake3 } from '@noble/hashes/blake3.js';
import type { AccountId, Payload, Transaction } from './types';
import { accountIdFromHex, accountIdToHex } from './types';
import { buildSignedTransactionHex } from './signing';
import { rpcCall, isMethodNotFoundError } from './rpc';

export const NAME_SUFFIX = '.boing';
export const NAME_MAX_YEARS = 10;
const COMMIT_DOMAIN = 'BOING_NAME_COMMIT_V1';

export const RESERVED_NAMES: readonly string[] = [
  'boing', 'admin', 'administrator', 'root', 'system', 'validator', 'validators', 'faucet',
  'observer', 'wallet', 'support', 'help', 'official', 'team', 'dex', 'finance', 'express',
  'network', 'treasury', 'governance', 'security', 'staking', 'bridge', 'testnet', 'mainnet',
  'null', 'undefined', 'anchor', 'registry', 'names',
];

export type NameValidation = { ok: true; label: string } | { ok: false; error: string };

/** Trim, lowercase, drop `.boing`; 3-32 of a-z 0-9 '-', no edge/double hyphen, not address-like. */
export function normalizeName(input: string): NameValidation {
  let s = (input ?? '').trim().toLowerCase();
  if (s.endsWith(NAME_SUFFIX)) s = s.slice(0, -NAME_SUFFIX.length);
  if (s.length < 3 || s.length > 32) return { ok: false, error: 'Names are 3-32 characters' };
  if (!/^[a-z0-9-]+$/.test(s)) return { ok: false, error: "Use only a-z, 0-9 and '-'" };
  if (s.startsWith('-') || s.endsWith('-') || s.includes('--')) {
    return { ok: false, error: "A name can't start or end with '-' or contain '--'" };
  }
  if (s.startsWith('0x') || /^[0-9]+$/.test(s) || (s.length >= 32 && /^[0-9a-f]+$/.test(s))) {
    return { ok: false, error: "A name can't look like an address or be only digits" };
  }
  return { ok: true, label: s };
}

export function isReservedName(label: string): boolean {
  return RESERVED_NAMES.includes(label);
}

/** 64-hex (optionally 0x) is an address; anything else that normalizes is a name. */
export function looksLikeName(input: string): boolean {
  const s = (input ?? '').replace(/\s/g, '');
  if (!s || /^(0x)?[0-9a-fA-F]{64}$/.test(s)) return false;
  return normalizeName(s).ok;
}

export function displayName(label: string): string {
  return `${label}${NAME_SUFFIX}`;
}

/** Yearly rent in whole BOING (testnet): 3 chars 10, 4 chars 5, 5 chars 2, 6+ chars 1. Burned. */
export function rentPerYear(label: string): bigint {
  const n = label.length;
  if (n <= 3) return 10n;
  if (n === 4) return 5n;
  if (n === 5) return 2n;
  return 1n;
}

export function rentFor(label: string, years: number): bigint {
  return rentPerYear(label) * BigInt(years);
}

/** `blake3(domain || u32le(len) || label || owner || salt)` (Rust `name_commitment`). */
export function nameCommitment(label: string, owner: AccountId, salt: Uint8Array): Uint8Array {
  if (salt.length !== 32 || owner.length !== 32) throw new Error('owner and salt must be 32 bytes');
  const enc = new TextEncoder();
  const dom = enc.encode(COMMIT_DOMAIN);
  const l = enc.encode(label);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, l.length, true);
  const pre = new Uint8Array(dom.length + 4 + l.length + 64);
  let o = 0;
  for (const part of [dom, len, l, owner, salt]) {
    pre.set(part, o);
    o += part.length;
  }
  return blake3(pre);
}

export function randomSalt(): Uint8Array {
  const s = new Uint8Array(32);
  globalThis.crypto.getRandomValues(s);
  return s;
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(h: string): Uint8Array {
  const s = h.replace(/^0x/i, '');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** One-line description of a name payload (for signing prompts and history). */
export function namePayloadSummary(p: Payload): string | null {
  switch (p.kind) {
    case 'name_commit':
      return 'Name: commit (hidden until registered)';
    case 'name_register':
      return `Name: register ${displayName(p.name)} for ${p.years} year(s) → 0x${accountIdToHex(p.target)}`;
    case 'name_renew':
      return `Name: renew ${displayName(p.name)} for ${p.years} year(s)`;
    case 'name_transfer':
      return `Name: transfer ${displayName(p.name)} to 0x${accountIdToHex(p.new_owner)}`;
    case 'name_set_target':
      return `Name: point ${displayName(p.name)} at 0x${accountIdToHex(p.target)}`;
    case 'name_set_primary':
      return p.name ? `Name: set primary name ${displayName(p.name)}` : 'Name: clear primary name';
    case 'name_release':
      return `Name: release ${displayName(p.name)}`;
    default:
      return null;
  }
}

// ---- RPC ----

export type NameStatus = 'active' | 'grace' | 'expired';

export interface NameRecord {
  name: string;
  display: string;
  owner: string;
  target: string;
  registered_at: number;
  expires_at: number;
  status: NameStatus;
}

export interface NameRegistryInfo {
  enabled: boolean;
  active?: boolean;
  activation_height?: number;
  blocks_per_year?: number;
  grace_blocks?: number;
  commit_min_age?: number;
  commit_max_age?: number;
}

export interface NameInfo {
  input: string;
  name?: string;
  display?: string;
  valid: boolean;
  error?: string;
  reserved?: boolean;
  available: boolean;
  status?: NameStatus | null;
  rent_per_year?: string;
  record?: NameRecord;
  registry?: NameRegistryInfo;
  head_height?: number;
}

export interface ReverseName {
  name: string;
  display: string;
  address: string;
  verified: boolean;
}

/** `null` when the node has no name registry (method not found) or the name does not resolve. */
async function soft<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (isMethodNotFoundError(e)) return fallback;
    throw e;
  }
}

export function resolveName(rpcUrl: string, name: string): Promise<NameRecord | null> {
  return soft(rpcCall<NameRecord | null>(rpcUrl, 'boing_resolveName', [name]), null);
}

export function reverseName(rpcUrl: string, addressHex: string): Promise<ReverseName | null> {
  const a = addressHex.startsWith('0x') ? addressHex : `0x${addressHex}`;
  return soft(rpcCall<ReverseName | null>(rpcUrl, 'boing_reverseName', [a]), null);
}

export function getNameInfo(rpcUrl: string, name: string): Promise<NameInfo | null> {
  return soft(rpcCall<NameInfo | null>(rpcUrl, 'boing_getNameInfo', [name]), null);
}

export function namesOwnedBy(rpcUrl: string, addressHex: string): Promise<NameRecord[]> {
  const a = addressHex.startsWith('0x') ? addressHex : `0x${addressHex}`;
  return soft(rpcCall<NameRecord[]>(rpcUrl, 'boing_namesOwnedBy', [a]), []);
}

export type ResolvedRecipient = { ok: true; hex: string; name?: string } | { ok: false; error: string };

/** Recipient field input → 64-hex (lowercase, no 0x). Names are resolved on-chain. */
export async function resolveRecipient(rpcUrl: string, input: string): Promise<ResolvedRecipient> {
  const raw = (input ?? '').replace(/\s/g, '');
  const hex = raw.replace(/^0x/i, '');
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return { ok: true, hex: hex.toLowerCase() };
  const v = normalizeName(raw);
  if (!v.ok) {
    return { ok: false, error: /[g-z.]/i.test(raw) ? `Invalid name: ${v.error}` : 'Invalid address: must be 64 hex characters or a .boing name' };
  }
  const rec = await resolveName(rpcUrl, v.label);
  if (!rec) return { ok: false, error: `${displayName(v.label)} is not registered (or has expired)` };
  return { ok: true, hex: rec.target.replace(/^0x/i, '').toLowerCase(), name: v.label };
}

// ---- transactions ----

export function signNamePayload(sender: AccountId, nonce: bigint, payload: Payload, privateKey: Uint8Array): Promise<string> {
  const tx: Transaction = { nonce, sender, payload, access_list: { read: [sender], write: [sender] } };
  return buildSignedTransactionHex(tx, privateKey);
}

export interface NameTxContext {
  rpcUrl: string;
  sender: AccountId;
  privateKey: Uint8Array;
  getNonce: () => Promise<bigint>;
  submit: (signedHex: string) => Promise<{ success: boolean; txHash?: string; error?: string }>;
}

export async function sendNamePayload(ctx: NameTxContext, payload: Payload): Promise<string> {
  const nonce = await ctx.getNonce();
  const hex = await signNamePayload(ctx.sender, nonce, payload, ctx.privateKey);
  const r = await ctx.submit(hex);
  if (!r.success) throw new Error(r.error ?? 'Submit failed');
  return r.txHash ?? '';
}

async function waitForReceipt(rpcUrl: string, txHash: string, timeoutMs = 60_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await rpcCall<{ success?: boolean; error?: string } | null>(rpcUrl, 'boing_getTransactionReceipt', [txHash]).catch(() => null);
    if (r) {
      if (r.success === false) throw new Error(r.error ?? 'Transaction failed');
      return;
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error('Timed out waiting for the commit to be included');
}

export type ClaimStep = 'commit' | 'wait' | 'register' | 'primary' | 'done';

/**
 * Commit → wait for inclusion → register (retrying while the commit is too new) → optional primary.
 * The salt never leaves the wallet before the register tx reveals it.
 */
export async function claimName(
  ctx: NameTxContext,
  opts: { name: string; years?: number; target?: AccountId; primary?: boolean; onStep?: (s: ClaimStep) => void }
): Promise<NameRecord | null> {
  const v = normalizeName(opts.name);
  if (!v.ok) throw new Error(v.error);
  const label = v.label;
  const years = opts.years ?? 1;
  const salt = randomSalt();
  opts.onStep?.('commit');
  const commitHash = await sendNamePayload(ctx, { kind: 'name_commit', commitment: nameCommitment(label, ctx.sender, salt) });
  opts.onStep?.('wait');
  if (commitHash) await waitForReceipt(ctx.rpcUrl, commitHash);
  opts.onStep?.('register');
  const reg: Payload = { kind: 'name_register', name: label, salt, target: opts.target ?? ctx.sender, years };
  let regHash = '';
  for (let attempt = 0; ; attempt++) {
    try {
      regHash = await sendNamePayload(ctx, reg);
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < 10 && /too new|commit.*(young|recent)/i.test(msg)) {
        await new Promise((res) => setTimeout(res, 2000));
        continue;
      }
      throw e;
    }
  }
  if (regHash) await waitForReceipt(ctx.rpcUrl, regHash);
  if (opts.primary) {
    opts.onStep?.('primary');
    const h = await sendNamePayload(ctx, { kind: 'name_set_primary', name: label });
    if (h) await waitForReceipt(ctx.rpcUrl, h);
  }
  opts.onStep?.('done');
  return resolveName(ctx.rpcUrl, label);
}

export { accountIdFromHex };