/**
 * Access-list helpers aligned with boing-primitives `Transaction::suggested_parallel_access_list`.
 * Used when the wallet builds native txs or when a dApp omits `access_list`.
 */

import type { AccountId, AccessList, Payload } from './types';
import { accountIdFromHex, accountIdToHex } from './types';

export function emptyAccessList(): AccessList {
  return { read: [], write: [] };
}

/** Minimal parallel-scheduling list matching Rust heuristics (not full contract storage). */
export function suggestedAccessList(sender: AccountId, payload: Payload): AccessList {
  switch (payload.kind) {
    case 'transfer':
      return { read: [sender, payload.to], write: [sender, payload.to] };
    case 'contract_call':
      return { read: [sender, payload.contract], write: [sender, payload.contract] };
    case 'bond':
    case 'unbond':
    case 'claim_unbond':
    case 'qa_pool_vote':
      return { read: [sender], write: [sender] };
    case 'contract_deploy':
    case 'contract_deploy_purpose':
    case 'contract_deploy_meta':
      // Deploy suggestions need the predicted contract address (CREATE2 / nonce-derived).
      // Leave empty so dApps can supply a full list; simulation may return suggested_access_list.
      return emptyAccessList();
    default: {
      const _exhaustive: never = payload;
      return _exhaustive;
    }
  }
}

function pushUniqueAccount(into: AccountId[], seen: Set<string>, id: AccountId): void {
  const key = accountIdToHex(id).toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  into.push(id);
}

function tryParseAccountHex(hex: string): AccountId | null {
  try {
    return accountIdFromHex(hex);
  } catch {
    return null;
  }
}

/**
 * Union two access lists (dedupe by account hex). Order: `base` accounts first, then `extra`.
 * `extra` may use 0x-prefixed hex strings (RPC `suggested_access_list` shape).
 */
export function mergeAccessLists(
  base: AccessList,
  extra: { read?: string[]; write?: string[] } | AccessList | null | undefined,
): AccessList {
  const read: AccountId[] = [];
  const write: AccountId[] = [];
  const seenR = new Set<string>();
  const seenW = new Set<string>();

  for (const id of base.read) pushUniqueAccount(read, seenR, id);
  for (const id of base.write) pushUniqueAccount(write, seenW, id);

  if (!extra) return { read, write };

  const extraRead = Array.isArray((extra as AccessList).read) ? (extra as AccessList).read : [];
  const extraWrite = Array.isArray((extra as AccessList).write) ? (extra as AccessList).write : [];

  for (const item of extraRead) {
    const id = typeof item === 'string' ? tryParseAccountHex(item) : (item as AccountId);
    if (id) pushUniqueAccount(read, seenR, id);
  }
  for (const item of extraWrite) {
    const id = typeof item === 'string' ? tryParseAccountHex(item) : (item as AccountId);
    if (id) pushUniqueAccount(write, seenW, id);
  }
  return { read, write };
}

/** Merge RPC `suggested_access_list` hex strings into a tx access list. */
export function mergeSuggestedAccessListHex(
  base: AccessList,
  suggested: { read?: string[]; write?: string[] } | null | undefined,
): AccessList {
  return mergeAccessLists(base, suggested);
}
