import { describe, expect, it } from 'vitest';
import { assertValidQaPurposeCategory, transactionFromDappJson } from '../src/boing/dappTxRequest';

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
});
