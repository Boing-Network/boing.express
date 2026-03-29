/**
 * Boing Network types — bincode layout matches Rust boing-primitives (see src/boing/bincode.ts).
 * AccountId = 32 bytes (Ed25519 public key).
 */

export type AccountId = Uint8Array; // 32 bytes

/** Payload variants — `kind` maps to Rust TransactionPayload enum order (u32 discriminant). */
export type Payload =
  | { kind: 'transfer'; to: AccountId; amount: bigint }
  | { kind: 'contract_call'; contract: AccountId; calldata: Uint8Array }
  | { kind: 'contract_deploy'; bytecode: Uint8Array }
  | {
      kind: 'contract_deploy_purpose';
      bytecode: Uint8Array;
      purpose_category: string;
      description_hash: Uint8Array | null;
    }
  | {
      kind: 'contract_deploy_meta';
      bytecode: Uint8Array;
      purpose_category: string;
      description_hash: Uint8Array | null;
      asset_name: string | null;
      asset_symbol: string | null;
    }
  | { kind: 'bond'; amount: bigint }
  | { kind: 'unbond'; amount: bigint };

export interface AccessList {
  read: AccountId[];
  write: AccountId[];
}

export interface Transaction {
  nonce: bigint; // u64
  sender: AccountId;
  payload: Payload;
  access_list: AccessList;
}

export interface SignedTransaction {
  tx: Transaction;
  signature: Uint8Array; // 64 bytes Ed25519
}

/** Parse 64-char hex (with or without 0x) to AccountId. */
export function accountIdFromHex(hex: string): AccountId {
  const h = hex.replace(/^0x/i, '');
  if (h.length !== 64 || !/^[0-9a-fA-F]+$/.test(h)) throw new Error('Invalid account id: must be 64 hex chars');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** AccountId to 64-char hex (no 0x). */
export function accountIdToHex(id: AccountId): string {
  if (id.length !== 32) throw new Error('AccountId must be 32 bytes');
  return Array.from(id)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Format for display: optional 0x prefix. */
export function formatAddress(accountId: AccountId, withPrefix = false): string {
  const hex = accountIdToHex(accountId);
  return withPrefix ? '0x' + hex : hex;
}
