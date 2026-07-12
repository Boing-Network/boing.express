/**
 * Access-list helpers aligned with boing-primitives `Transaction::suggested_parallel_access_list`.
 * Used when the wallet builds native txs or when a dApp omits `access_list`.
 */

import type { AccountId, AccessList, Payload } from './types';

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
