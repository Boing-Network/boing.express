/**
 * Boing signable hash and signed tx construction.
 * signable_hash = BLAKE3( nonce_LE(8) || sender(32) || bincode(payload) || bincode(access_list) )
 * Signature = Ed25519(signable_hash). Submit hex(bincode(SignedTransaction)).
 */

import { blake3 } from '@noble/hashes/blake3.js';
import * as ed from '@noble/ed25519';
import type { Transaction, SignedTransaction } from './types';
import { encodePayload, encodeAccessList, encodeSignedTransaction } from './bincode';
import { rpcCall } from './rpc';
import { SIGNING_DOMAINS } from '../networks/chainDefaults.generated';

/** Signable message = BLAKE3( nonce_LE(8) || sender(32) || bincode(payload) || bincode(access_list) ). */
export function signableHash(tx: Transaction): Uint8Array {
  const nonceBuf = new Uint8Array(8);
  new DataView(nonceBuf.buffer).setBigUint64(0, tx.nonce, true);
  const payloadBytes = encodePayload(tx.payload);
  const accessBytes = encodeAccessList(tx.access_list);
  const total = 8 + 32 + payloadBytes.length + accessBytes.length;
  const input = new Uint8Array(total);
  input.set(nonceBuf, 0);
  input.set(tx.sender, 8);
  input.set(payloadBytes, 40);
  input.set(accessBytes, 40 + payloadBytes.length);
  return blake3(input);
}

// Domains come from boing.network chain-metadata.json (generated); tests/txSigningGolden.test.ts pins the resulting digests.
const DOMAIN_V2 = new TextEncoder().encode(SIGNING_DOMAINS.tx);
const DOMAIN_PRIORITY = new TextEncoder().encode(SIGNING_DOMAINS.priorityTip);

/**
 * v2 (chain-bound) signable hash, security fix #2 (cross-chain replay):
 * BLAKE3( "BOING_TX_V2" || chain_id_LE(8) || nonce_LE(8) || sender(32) || bincode(payload) || bincode(access_list) ).
 * Nodes reject the legacy hash after their activation height (testnet 6913: 900; mainnet 6914: genesis).
 */
export function signableHashV2(tx: Transaction, chainId: bigint): Uint8Array {
  const legacyBody = legacyPreimage(tx);
  const input = new Uint8Array(DOMAIN_V2.length + 8 + legacyBody.length);
  input.set(DOMAIN_V2, 0);
  new DataView(input.buffer).setBigUint64(DOMAIN_V2.length, chainId, true);
  input.set(legacyBody, DOMAIN_V2.length + 8);
  return blake3(input);
}

/**
 * Signable digest including an optional priority tip. Tip `0` == [`signableHashV2`].
 * Non-zero: BLAKE3(`BOING_TX_PRIORITY` || chain_id || nonce || sender || payload || access_list || tip_le16).
 */
export function signableHashWithTip(tx: Transaction, chainId: bigint, priorityTip: bigint = tx.priorityTip ?? 0n): Uint8Array {
  if (priorityTip === 0n) return signableHashV2(tx, chainId);
  const legacyBody = legacyPreimage(tx);
  const tipBuf = new Uint8Array(16);
  new DataView(tipBuf.buffer).setBigUint64(0, priorityTip & ((1n << 64n) - 1n), true);
  new DataView(tipBuf.buffer).setBigUint64(8, priorityTip >> 64n, true);
  const input = new Uint8Array(DOMAIN_PRIORITY.length + 8 + legacyBody.length + 16);
  input.set(DOMAIN_PRIORITY, 0);
  new DataView(input.buffer).setBigUint64(DOMAIN_PRIORITY.length, chainId, true);
  input.set(legacyBody, DOMAIN_PRIORITY.length + 8);
  input.set(tipBuf, DOMAIN_PRIORITY.length + 8 + legacyBody.length);
  return blake3(input);
}

function legacyPreimage(tx: Transaction): Uint8Array {
  const nonceBuf = new Uint8Array(8);
  new DataView(nonceBuf.buffer).setBigUint64(0, tx.nonce, true);
  const payloadBytes = encodePayload(tx.payload);
  const accessBytes = encodeAccessList(tx.access_list);
  const input = new Uint8Array(8 + 32 + payloadBytes.length + accessBytes.length);
  input.set(nonceBuf, 0);
  input.set(tx.sender, 8);
  input.set(payloadBytes, 40);
  input.set(accessBytes, 40 + payloadBytes.length);
  return input;
}

/** Sign a transaction with Ed25519 private key (32 bytes). `chainId` = v2 domain; omitted/null = legacy. */
export async function signTransaction(
  tx: Transaction,
  privateKey: Uint8Array,
  chainId?: bigint | null
): Promise<Uint8Array> {
  const tip = tx.priorityTip ?? 0n;
  let message: Uint8Array;
  if (chainId == null) {
    if (tip !== 0n) throw new Error('priorityTip requires chain-bound (v2) signing');
    message = signableHash(tx);
  } else {
    message = tip === 0n ? signableHashV2(tx, chainId) : signableHashWithTip(tx, chainId, tip);
  }
  const sig = await ed.signAsync(message, privateKey);
  return sig;
}

type HealthTxSigning = { v2_supported?: boolean; chain_id?: number | null };
const chainIdCache = new Map<string, { at: number; value: bigint | null }>();
/** Network-config chain id per RPC URL, registered by the Boing adapter; used when the node probe fails. */
const configuredChainByRpc = new Map<string, bigint>();

/** Remember the configured chain id for an RPC URL so a failed `boing_health` probe never degrades to legacy signing. */
export function registerConfiguredSigningChainId(rpcUrl: string, chainId: bigint): void {
  configuredChainByRpc.set(rpcUrl, chainId);
}

/**
 * Chain id the node at `rpcUrl` signs for (`boing_health.tx_signing`), or null for older nodes / local
 * dev chains without a chain id (legacy signing). Cached per RPC URL (null results for 60 s).
 */
export async function signingChainIdForRpc(
  rpcUrl: string,
  fallbackChainId: bigint | null = configuredChainByRpc.get(rpcUrl) ?? null
): Promise<bigint | null> {
  const hit = chainIdCache.get(rpcUrl);
  if (hit && (hit.value != null || Date.now() - hit.at < 60_000)) return hit.value ?? fallbackChainId ?? null;
  let value: bigint | null = null;
  let probed = false;
  try {
    // `rpcCall` is bounded by a request timeout, so a hung node cannot stall signing.
    const health = (await rpcCall<{ tx_signing?: HealthTxSigning }>(rpcUrl, 'boing_health', [])) ?? {};
    probed = true;
    const ts = health.tx_signing;
    if (ts && ts.v2_supported && typeof ts.chain_id === 'number') value = BigInt(ts.chain_id);
  } catch {
    value = null;
  }
  // Only cache a definitive answer (a probe that returned). A failed probe is retried on the next call
  // after a short pause so a transient outage does not pin legacy signing for a minute.
  chainIdCache.set(rpcUrl, { at: probed ? Date.now() : Date.now() - 55_000, value });
  // Probe failed (or older node without tx_signing): prefer the network's configured chain id over
  // legacy signing, because chain-bound networks reject legacy signatures after the v2 height.
  return value ?? fallbackChainId ?? null;
}

/** Test hook. */
export function clearSigningChainIdCache(): void {
  chainIdCache.clear();
  configuredChainByRpc.clear();
}

/** Build SignedTransaction and return hex for boing_submitTransaction. Pass the network's chain id (v2). */
export async function buildSignedTransactionHex(
  tx: Transaction,
  privateKey: Uint8Array,
  chainId?: bigint | null
): Promise<string> {
  const signature = await signTransaction(tx, privateKey, chainId);
  const signed: SignedTransaction = { tx, signature };
  const bytes = encodeSignedTransaction(signed);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
