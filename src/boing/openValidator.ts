/**
 * Open (permissionless) validator set: registration proof, payload builders and the
 * `boing_getValidators` report. Mirrors boing.network `crates/boing-primitives/src/validator_registration.rs`.
 *
 * The node (consensus) secret key is only used here, in memory, to sign the proof of possession.
 * It is never stored, logged or sent anywhere; only its public key and signature go on-chain.
 */

import { blake3 } from '@noble/hashes/blake3.js';
import * as ed from '@noble/ed25519';
import type { AccountId, Payload } from './types';

export const VALIDATOR_REGISTRATION_DOMAIN = 'BOING_OPEN_VALIDATOR_REGISTER_V1';

/** BLAKE3(domain || owner || nodeId), the 32-byte message the node key signs. */
export function validatorRegistrationMessage(owner: AccountId, nodeId: AccountId): Uint8Array {
  const dom = new TextEncoder().encode(VALIDATOR_REGISTRATION_DOMAIN);
  const pre = new Uint8Array(dom.length + 64);
  pre.set(dom, 0);
  pre.set(owner, dom.length);
  pre.set(nodeId, dom.length + 32);
  return blake3(pre);
}

/** Parse a 32-byte ed25519 seed from hex (optional 0x). Throws on bad input without echoing it. */
export function parseNodeSecretHex(input: string): Uint8Array {
  const h = input.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error('Node key must be 64 hex characters (32-byte seed).');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Fresh random node seed (browser CSPRNG). */
export function generateNodeSecret(): Uint8Array {
  const s = new Uint8Array(32);
  crypto.getRandomValues(s);
  return s;
}

export async function nodeIdFromSecret(secret: Uint8Array): Promise<AccountId> {
  return ed.getPublicKeyAsync(secret) as Promise<AccountId>;
}

export async function buildRegisterPayload(owner: AccountId, nodeSecret: Uint8Array): Promise<Payload> {
  const nodeId = await nodeIdFromSecret(nodeSecret);
  const sig = await ed.signAsync(validatorRegistrationMessage(owner, nodeId), nodeSecret);
  return { kind: 'validator_register', node_id: nodeId, node_signature: sig };
}

export async function verifyRegistration(owner: AccountId, nodeId: AccountId, sig: Uint8Array): Promise<boolean> {
  try {
    return await ed.verifyAsync(sig, validatorRegistrationMessage(owner, nodeId), nodeId);
  } catch {
    return false;
  }
}

export interface ValidatorEntry {
  id: string;
  kind: 'anchor' | 'static' | 'open' | string;
  status: 'active' | 'pending' | 'jailed' | 'exiting' | string;
  in_set: boolean;
  owner: string | null;
  bond: string;
  registered_at: number | null;
  jailed_until: number | null;
  jail_count: number;
  scheduled_proposals: number;
  missed_proposals: number;
  uptime_pct: number;
}

export interface OpenParams {
  activation_height: number;
  activated_at: number | null;
  bond: string;
  deregister_delay: number;
  epoch_len: number;
  next_epoch_height: number | null;
  max_open_validators: number;
  liveness_window: number;
  miss_threshold_bps: number;
  jail_cooldown: number;
}

export interface ValidatorsReport {
  mode: 'static' | 'stake' | 'open' | string;
  height: number;
  quorum: number;
  validator_count: number;
  open: OpenParams | null;
  validators: ValidatorEntry[];
}

export type RegistrationAvailability =
  | { state: 'unsupported' }
  | { state: 'not_open'; mode: string }
  | { state: 'scheduled'; activationHeight: number; height: number }
  | { state: 'open' };

/** Whether registration transactions will be accepted right now. */
export function registrationAvailability(r: ValidatorsReport | null): RegistrationAvailability {
  if (!r) return { state: 'unsupported' };
  if (r.mode !== 'open' || !r.open) return { state: 'not_open', mode: r.mode };
  if (r.open.activated_at == null) {
    return { state: 'scheduled', activationHeight: r.open.activation_height, height: r.height };
  }
  return { state: 'open' };
}

/** Open validators owned by `ownerHex` (0x-prefixed or not, case-insensitive). */
export function validatorsOwnedBy(r: ValidatorsReport | null, ownerHex: string): ValidatorEntry[] {
  if (!r) return [];
  const norm = (s: string) => s.toLowerCase().replace(/^0x/, '');
  const o = norm(ownerHex);
  return r.validators.filter((v) => v.kind === 'open' && v.owner != null && norm(v.owner) === o);
}

/** Unjail allowed once `height >= jailed_until`. */
export function canUnjail(v: ValidatorEntry, height: number): boolean {
  return v.status === 'jailed' && v.jailed_until != null && height >= v.jailed_until;
}
