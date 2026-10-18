/**
 * Boing Network types — bincode layout matches Rust boing-primitives (see src/boing/bincode.ts).
 * AccountId = 32 bytes (Ed25519 public key).
 */

export type AccountId = Uint8Array; // 32 bytes

/** Payload variants — `kind` maps to Rust TransactionPayload enum order (u32 discriminant). */
export type Payload =
  | { kind: 'transfer'; to: AccountId; amount: bigint }
  /**
   * `value` (base units, optional): native BOING sent with the call. A non-zero value encodes as Rust
   * `ContractCallWithValue` (index 20; testnet from height 1150), otherwise as `ContractCall` (index 1).
   */
  | { kind: 'contract_call'; contract: AccountId; calldata: Uint8Array; value?: bigint }
  /** `create2_salt` None → nonce-derived deploy address; Some(32 bytes) → CREATE2 (see TECHNICAL-SPECIFICATION §4.4). */
  | { kind: 'contract_deploy'; bytecode: Uint8Array; create2_salt: Uint8Array | null }
  | {
      kind: 'contract_deploy_purpose';
      bytecode: Uint8Array;
      purpose_category: string;
      description_hash: Uint8Array | null;
      create2_salt: Uint8Array | null;
    }
  | {
      kind: 'contract_deploy_meta';
      bytecode: Uint8Array;
      purpose_category: string;
      description_hash: Uint8Array | null;
      asset_name: string | null;
      asset_symbol: string | null;
      create2_salt: Uint8Array | null;
    }
  | { kind: 'bond'; amount: bigint }
  | { kind: 'unbond'; amount: bigint }
  /** Claim matured `pending_unbond` after unlock height (Rust `ClaimUnbond`, variant 7). */
  | { kind: 'claim_unbond' }
  /** On-chain QA pool vote (Rust `QaPoolVote`, variant 8). */
  | { kind: 'qa_pool_vote'; subject: AccountId; vote: 'allow' | 'reject' | 'abstain' }
  /** Rust `ValidatorRegister` (index 10): owner = sender, node key proof of possession. */
  | { kind: 'validator_register'; node_id: AccountId; node_signature: Uint8Array }
  /** Rust `ValidatorDeregister` (index 11). */
  | { kind: 'validator_deregister'; node_id: AccountId }
  /** Rust `ValidatorUnjail` (index 12). */
  | { kind: 'validator_unjail'; node_id: AccountId }
  /** Rust `Batch` (index 9): up to 16 transfers / contract calls under one signature + nonce, applied atomically. */
  | { kind: 'batch'; calls: BatchCall[] }
  /** Name registry (Rust variants 13-19, see NAME-REGISTRY-PROPOSAL.md). `name` is a normalized label. */
  | { kind: 'name_commit'; commitment: Uint8Array }
  | { kind: 'name_register'; name: string; salt: Uint8Array; target: AccountId; years: number }
  | { kind: 'name_renew'; name: string; years: number }
  | { kind: 'name_transfer'; name: string; new_owner: AccountId }
  | { kind: 'name_set_target'; name: string; target: AccountId }
  | { kind: 'name_set_primary'; name: string | null }
  | { kind: 'name_release'; name: string };

/**
 * One step of a `batch` payload (Rust `BatchCall`: 0 = Transfer, 1 = ContractCall, 2 = ContractCallWithValue
 * when `value` is non-zero).
 */
export type BatchCall =
  | { kind: 'transfer'; to: AccountId; amount: bigint }
  | { kind: 'contract_call'; contract: AccountId; calldata: Uint8Array; value?: bigint };

/** Max steps in one batch (Rust `MAX_BATCH_CALLS`). */
export const MAX_BATCH_CALLS = 16;

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
