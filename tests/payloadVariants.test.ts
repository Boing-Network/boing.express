/**
 * Payload variant indices 0-35 (BOING-SIGNED-TRANSACTION-ENCODING.md) and chain-bound (v2) signing for the
 * two Boing chains. The index is a u32 LE bincode enum discriminant, so a wrong value silently produces a
 * different transaction type.
 */
import { describe, expect, it } from 'vitest';
import * as ed from '@noble/ed25519';
import * as sdk from '@boing-network/boing-sdk';
import { blake3 } from '@noble/hashes/blake3.js';
import { encodePayload } from '../src/boing/bincode';
import { signableHashV2, signTransaction } from '../src/boing/signing';
import type { Payload, Transaction } from '../src/boing/types';

const acct = (n: number) => new Uint8Array(32).fill(n);
const u32le = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, true);
const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');

/** The table from docs/BOING-SIGNED-TRANSACTION-ENCODING.md, in Rust declaration order. */
const SPEC_VARIANTS: Record<string, number> = {
  Transfer: 0,
  ContractCall: 1,
  ContractDeploy: 2,
  ContractDeployWithPurpose: 3,
  ContractDeployWithPurposeAndMetadata: 4,
  Bond: 5,
  Unbond: 6,
  ClaimUnbond: 7,
  QaPoolVote: 8,
  Batch: 9,
  ValidatorRegister: 10,
  ValidatorDeregister: 11,
  ValidatorUnjail: 12,
  NameCommit: 13,
  NameRegister: 14,
  NameRenew: 15,
  NameTransfer: 16,
  NameSetTarget: 17,
  NameSetPrimary: 18,
  NameRelease: 19,
  ContractCallWithValue: 20,
  PutBlob: 21,
  BlobAnnounce: 22,
  RenewMediaBlobPin: 23,
  PayBlobSample: 24,
  RegisterBlobSampleOffer: 25,
  SettleBlobSampleMatch: 26,
  CancelBlobSampleOffer: 27,
  ChallengeBlobSampleServe: 28,
  RespondBlobSampleServe: 29,
  SubmitSlashAppeal: 30,
  ResolveSlashAppeal: 31,
  ResolveSlashAppealAttested: 32,
  ResolveSlashAppealBlsAggregate: 33,
  GrantBlobDownload: 34,
  RevokeBlobDownload: 35,
};

type SdkPayload = Parameters<typeof sdk.encodeTransactionPayload>[0];

/** One wallet payload per variant the wallet can build (0-21), with the equivalent SDK payload. */
const WALLET_VARIANTS: Array<{ variant: string; wallet: Payload; sdk: SdkPayload }> = [
  { variant: 'Transfer', wallet: { kind: 'transfer', to: acct(9), amount: 5n }, sdk: { kind: 'transfer', to: acct(9), amount: 5n } },
  { variant: 'ContractCall', wallet: { kind: 'contract_call', contract: acct(4), calldata: new Uint8Array([1, 2]) }, sdk: { kind: 'contractCall', contract: acct(4), calldata: new Uint8Array([1, 2]) } },
  { variant: 'ContractDeploy', wallet: { kind: 'contract_deploy', bytecode: new Uint8Array([0, 1, 2]), create2_salt: null }, sdk: { kind: 'contractDeploy', bytecode: new Uint8Array([0, 1, 2]), create2Salt: null } },
  {
    variant: 'ContractDeployWithPurpose',
    wallet: { kind: 'contract_deploy_purpose', bytecode: new Uint8Array([3]), purpose_category: 'token', description_hash: null, create2_salt: null },
    sdk: { kind: 'contractDeployWithPurpose', bytecode: new Uint8Array([3]), purposeCategory: 'token', descriptionHash: null, create2Salt: null },
  },
  {
    variant: 'ContractDeployWithPurposeAndMetadata',
    wallet: { kind: 'contract_deploy_meta', bytecode: new Uint8Array([4]), purpose_category: 'token', description_hash: null, asset_name: 'Boing', asset_symbol: 'BNG', create2_salt: null },
    sdk: { kind: 'contractDeployWithPurposeAndMetadata', bytecode: new Uint8Array([4]), purposeCategory: 'token', descriptionHash: null, assetName: 'Boing', assetSymbol: 'BNG', create2Salt: null },
  },
  { variant: 'Bond', wallet: { kind: 'bond', amount: 7n }, sdk: { kind: 'bond', amount: 7n } },
  { variant: 'Unbond', wallet: { kind: 'unbond', amount: 7n }, sdk: { kind: 'unbond', amount: 7n } },
  { variant: 'ClaimUnbond', wallet: { kind: 'claim_unbond' }, sdk: { kind: 'claimUnbond' } },
  { variant: 'QaPoolVote', wallet: { kind: 'qa_pool_vote', subject: acct(5), vote: 'allow' }, sdk: { kind: 'qaPoolVote', subject: acct(5), vote: 'allow' } },
  {
    variant: 'Batch',
    wallet: { kind: 'batch', calls: [{ kind: 'transfer', to: acct(1), amount: 2n }] },
    sdk: { kind: 'batch', calls: [{ kind: 'transfer', to: acct(1), amount: 2n }] },
  },
  { variant: 'ValidatorRegister', wallet: { kind: 'validator_register', node_id: acct(6), node_signature: new Uint8Array(64).fill(1) }, sdk: { kind: 'validatorRegister', nodeId: acct(6), nodeSignature: new Uint8Array(64).fill(1) } },
  { variant: 'ValidatorDeregister', wallet: { kind: 'validator_deregister', node_id: acct(6) }, sdk: { kind: 'validatorDeregister', nodeId: acct(6) } },
  { variant: 'ValidatorUnjail', wallet: { kind: 'validator_unjail', node_id: acct(6) }, sdk: { kind: 'validatorUnjail', nodeId: acct(6) } },
  { variant: 'NameCommit', wallet: { kind: 'name_commit', commitment: acct(8) }, sdk: { kind: 'nameCommit', commitment: acct(8) } },
  { variant: 'NameRegister', wallet: { kind: 'name_register', name: 'nico', salt: acct(2), target: acct(3), years: 1 }, sdk: { kind: 'nameRegister', name: 'nico', salt: acct(2), target: acct(3), years: 1 } },
  { variant: 'NameRenew', wallet: { kind: 'name_renew', name: 'nico', years: 2 }, sdk: { kind: 'nameRenew', name: 'nico', years: 2 } },
  { variant: 'NameTransfer', wallet: { kind: 'name_transfer', name: 'nico', new_owner: acct(3) }, sdk: { kind: 'nameTransfer', name: 'nico', newOwner: acct(3) } },
  { variant: 'NameSetTarget', wallet: { kind: 'name_set_target', name: 'nico', target: acct(3) }, sdk: { kind: 'nameSetTarget', name: 'nico', target: acct(3) } },
  { variant: 'NameSetPrimary', wallet: { kind: 'name_set_primary', name: 'nico' }, sdk: { kind: 'nameSetPrimary', name: 'nico' } },
  { variant: 'NameRelease', wallet: { kind: 'name_release', name: 'nico' }, sdk: { kind: 'nameRelease', name: 'nico' } },
  { variant: 'ContractCallWithValue', wallet: { kind: 'contract_call', contract: acct(4), calldata: new Uint8Array([1]), value: 9n }, sdk: { kind: 'contractCallWithValue', contract: acct(4), calldata: new Uint8Array([1]), value: 9n } },
  {
    variant: 'PutBlob',
    wallet: { kind: 'put_blob', retention: { kind: 'forever' }, contentType: 'image/png', data: new Uint8Array([1, 2]) },
    sdk: { kind: 'putBlob', retention: { kind: 'forever' }, contentType: 'image/png', data: new Uint8Array([1, 2]) },
  },
];

describe('payload variant indices (0-35)', () => {
  it('the spec table is 36 contiguous indices and matches boing-sdk PayloadVariant exactly', () => {
    const values = Object.values(SPEC_VARIANTS).sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: 36 }, (_, i) => i));
    expect({ ...sdk.PayloadVariant }).toEqual(SPEC_VARIANTS);
  });

  it.each(WALLET_VARIANTS)('wallet encodes $variant with its spec index and the same bytes as the SDK', ({ variant, wallet, sdk: sdkPayload }) => {
    const bytes = encodePayload(wallet);
    expect(u32le(bytes)).toBe(SPEC_VARIANTS[variant]);
    expect(hex(bytes)).toBe(hex(sdk.encodeTransactionPayload(sdkPayload)));
  });

  it('covers every index the wallet can build (0-21)', () => {
    expect(WALLET_VARIANTS.map((v) => SPEC_VARIANTS[v.variant])).toEqual(Array.from({ length: 22 }, (_, i) => i));
  });

  it('batch sub-call tags: 0 transfer, 1 contract call, 2 contract call with value', () => {
    // After the u32 variant (4) and the u64 LE call count (8), each step starts with its u32 tag.
    const tag = (call: Payload & { kind: 'batch' }) => u32le(encodePayload(call).subarray(12));
    expect(tag({ kind: 'batch', calls: [{ kind: 'transfer', to: acct(1), amount: 1n }] })).toBe(0);
    expect(tag({ kind: 'batch', calls: [{ kind: 'contract_call', contract: acct(1), calldata: new Uint8Array([1]) }] })).toBe(1);
    expect(tag({ kind: 'batch', calls: [{ kind: 'contract_call', contract: acct(1), calldata: new Uint8Array([1]), value: 3n }] })).toBe(2);
    expect({ ...sdk.BatchCallVariant }).toEqual({ Transfer: 0, ContractCall: 1, ContractCallWithValue: 2 });
  });
});

describe('v2 chain-bound signing: testnet 6913 / mainnet 6914', () => {
  const enc = new TextEncoder();
  async function txFor() {
    const sk = new Uint8Array(32).fill(7);
    const sender = await ed.getPublicKeyAsync(sk);
    const tx: Transaction = { nonce: 3n, sender, payload: { kind: 'transfer', to: acct(9), amount: 5n }, access_list: { read: [], write: [] } };
    return { sk, tx };
  }

  it('chain ids are 6913 (0x1b01) and 6914 (0x1b02)', () => {
    expect(6913).toBe(0x1b01);
    expect(6914).toBe(0x1b02);
  });

  it('digest = BLAKE3("BOING_TX_V2" || chain_id_le8 || nonce_le8 || sender || payload || access_list)', async () => {
    const { tx } = await txFor();
    const payload = encodePayload(tx.payload);
    const accessList = new Uint8Array(16); // two empty Vec<[u8;32]> (u64 LE length 0 each)
    for (const [chain, name] of [[6913n, 'testnet'], [6914n, 'mainnet']] as const) {
      const le8 = (n: bigint) => {
        const b = new Uint8Array(8);
        new DataView(b.buffer).setBigUint64(0, n, true);
        return b;
      };
      const pre = new Uint8Array([...enc.encode('BOING_TX_V2'), ...le8(chain), ...le8(tx.nonce), ...tx.sender, ...payload, ...accessList]);
      expect(hex(signableHashV2(tx, chain)), name).toBe(hex(blake3(pre)));
      expect(hex(signableHashV2(tx, chain)), name).toBe(hex(sdk.signableTransactionHashV2(sdkTxFor(tx), chain)));
    }
  });

  it('the two chains produce different digests, and a signature only verifies on its own chain', async () => {
    const { tx, sk } = await txFor();
    const h6913 = signableHashV2(tx, 6913n);
    const h6914 = signableHashV2(tx, 6914n);
    expect(hex(h6913)).not.toBe(hex(h6914));
    const sig6913 = await signTransaction(tx, sk, 6913n);
    const sig6914 = await signTransaction(tx, sk, 6914n);
    expect(await ed.verifyAsync(sig6913, h6913, tx.sender)).toBe(true);
    expect(await ed.verifyAsync(sig6913, h6914, tx.sender)).toBe(false);
    expect(await ed.verifyAsync(sig6914, h6914, tx.sender)).toBe(true);
    expect(await ed.verifyAsync(sig6914, h6913, tx.sender)).toBe(false);
  });

  function sdkTxFor(tx: Transaction) {
    return { nonce: tx.nonce, sender: tx.sender, payload: { kind: 'transfer' as const, to: acct(9), amount: 5n }, accessList: { read: [], write: [] } };
  }
});