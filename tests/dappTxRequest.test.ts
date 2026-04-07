import { describe, expect, it } from 'vitest';
import {
  accessListFromDappJson,
  assertValidQaPurposeCategory,
  buildTransactionApprovalDetail,
  transactionFromDappJson,
  transactionSummary,
} from '../src/boing/dappTxRequest';

const sender = new Uint8Array(32).fill(9);

describe('dappTxRequest QA policy', () => {
  it('rejects legacy contract_deploy', () => {
    expect(() =>
      transactionFromDappJson({ type: 'contract_deploy', bytecode: '0x00' }, sender, 0n)
    ).toThrow(/contract_deploy_purpose/);
  });

  it('validates purpose category', () => {
    expect(() => assertValidQaPurposeCategory('definitely_invalid')).toThrow(/Invalid purpose_category/);
    expect(() => assertValidQaPurposeCategory('dapp')).not.toThrow();
    expect(() => assertValidQaPurposeCategory('DApp')).not.toThrow();
  });

  it('accepts contract_deploy_purpose with valid purpose', () => {
    const tx = transactionFromDappJson(
      { type: 'contract_deploy_purpose', bytecode: '0xab', purpose_category: 'token' },
      sender,
      1n
    );
    expect(tx.payload.kind).toBe('contract_deploy_purpose');
  });

  it('defaults purpose_category to token when asset metadata is set', () => {
    const tx = transactionFromDappJson(
      {
        type: 'contract_deploy_meta',
        bytecode: '0xab',
        asset_name: 'My Coin',
        asset_symbol: 'MC',
      },
      sender,
      0n
    );
    expect(tx.payload.kind).toBe('contract_deploy_meta');
    if (tx.payload.kind === 'contract_deploy_meta') {
      expect(tx.payload.purpose_category).toBe('token');
      expect(tx.payload.create2_salt).toBeNull();
    }
  });

  const salt32 = '0x' + '01'.repeat(32);

  it('parses create2_salt on contract_deploy_meta', () => {
    const tx = transactionFromDappJson(
      {
        type: 'contract_deploy_meta',
        bytecode: '0xab',
        purpose_category: 'token',
        create2_salt: salt32,
      },
      sender,
      0n
    );
    expect(tx.payload.kind).toBe('contract_deploy_meta');
    if (tx.payload.kind === 'contract_deploy_meta') {
      expect(tx.payload.create2_salt?.length).toBe(32);
      expect(tx.payload.create2_salt?.[0]).toBe(1);
    }
  });

  it('rejects create2_salt with wrong length', () => {
    expect(() =>
      transactionFromDappJson(
        { type: 'contract_deploy_meta', bytecode: '0xab', purpose_category: 'token', create2_salt: '0x00ff' },
        sender,
        0n
      )
    ).toThrow(/32 bytes/);
  });

  it('rejects contract_deploy_meta without purpose or asset fields', () => {
    expect(() =>
      transactionFromDappJson({ type: 'contract_deploy_meta', bytecode: '0xab' }, sender, 0n)
    ).toThrow(/purpose_category is required/);
  });

  const poolHex = '0x' + 'ff'.repeat(32);

  it('parses access_list / accessList on contract_call', () => {
    const tx = transactionFromDappJson(
      {
        type: 'contract_call',
        contract: poolHex,
        calldata: '0x',
        access_list: { read: [poolHex], write: [] },
      },
      sender,
      0n
    );
    expect(tx.access_list.read.length).toBe(1);
    expect(tx.access_list.write.length).toBe(0);
  });

  it('accepts camelCase accessList', () => {
    const tx = transactionFromDappJson(
      {
        type: 'transfer',
        to: poolHex,
        amount: '1',
        accessList: { read: [], write: [poolHex] },
      },
      sender,
      0n
    );
    expect(tx.access_list.write.length).toBe(1);
  });

  it('transactionSummary includes access_list counts for contract_call', () => {
    const tx = transactionFromDappJson(
      { type: 'contract_call', contract: poolHex, calldata: '0x', access_list: { read: [poolHex], write: [] } },
      sender,
      0n
    );
    expect(transactionSummary(tx)).toMatch(/access_list read:1 write:0/);
  });

  it('accessListFromDappJson rejects non-object', () => {
    expect(() => accessListFromDappJson([])).toThrow(/must be an object/);
  });
});

describe('buildTransactionApprovalDetail', () => {
  const sender = new Uint8Array(32).fill(9);
  const poolHex = '0x' + 'ff'.repeat(32);

  it('includes transfer fields and optional access list row', () => {
    const tx = transactionFromDappJson(
      { type: 'transfer', to: poolHex, amount: '42', access_list: { read: [poolHex], write: [] } },
      sender,
      3n
    );
    const d = buildTransactionApprovalDetail(tx);
    expect(d.txType).toBe('transfer');
    expect(d.rows.some((r) => r.label === 'Operation' && r.value === 'Transfer')).toBe(true);
    expect(d.rows.some((r) => r.label === 'Amount' && r.value.includes('42'))).toBe(true);
    expect(d.rows.some((r) => r.label === 'Access list')).toBe(true);
    expect(d.summaryLine).toBe(transactionSummary(tx));
  });

  it('omits access list row for transfer when empty', () => {
    const tx = transactionFromDappJson({ type: 'transfer', to: poolHex, amount: '1' }, sender, 0n);
    const d = buildTransactionApprovalDetail(tx);
    expect(d.rows.some((r) => r.label === 'Access list')).toBe(false);
  });

  it('includes contract call, calldata preview, and access list', () => {
    const tx = transactionFromDappJson(
      {
        type: 'contract_call',
        contract: poolHex,
        calldata: '0xdeadbeef',
        access_list: { read: [poolHex], write: [poolHex] },
      },
      sender,
      1n
    );
    const d = buildTransactionApprovalDetail(tx);
    expect(d.txType).toBe('contract_call');
    expect(d.rows.some((r) => r.label === 'Operation' && r.value === 'Contract call')).toBe(true);
    expect(d.rows.some((r) => r.label === 'Calldata' && r.value.includes('deadbeef'))).toBe(true);
    const al = d.rows.find((r) => r.label === 'Access list');
    expect(al?.value).toMatch(/1 read/);
    expect(al?.value).toMatch(/1 write/);
  });

  it('includes deploy meta rows and bytecode preview', () => {
    const tx = transactionFromDappJson(
      {
        type: 'contract_deploy_meta',
        bytecode: '0x6000',
        asset_name: 'Coin',
        asset_symbol: 'C',
      },
      sender,
      0n
    );
    const d = buildTransactionApprovalDetail(tx);
    expect(d.txType).toBe('contract_deploy_meta');
    expect(d.rows.some((r) => r.label === 'Asset' && r.value.includes('Coin'))).toBe(true);
    expect(d.rows.some((r) => r.label === 'Bytecode')).toBe(true);
  });
});
