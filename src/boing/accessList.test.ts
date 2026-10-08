import { describe, expect, it } from 'vitest';
import { emptyAccessList, mergeSuggestedAccessListHex, suggestedAccessList } from './accessList';
import { accountIdFromHex } from './types';

describe('mergeSuggestedAccessListHex', () => {
  it('unions suggested hex accounts into base list', () => {
    const sender = accountIdFromHex('11'.repeat(32));
    const contract = accountIdFromHex('22'.repeat(32));
    const token = accountIdFromHex('33'.repeat(32));
    const base = suggestedAccessList(sender, { kind: 'contract_call', contract, calldata: new Uint8Array() });
    const merged = mergeSuggestedAccessListHex(base, {
      read: [`0x${'33'.repeat(32)}`],
      write: [`0x${'33'.repeat(32)}`],
    });
    expect(merged.read).toHaveLength(3);
    expect(merged.write).toHaveLength(3);
    const again = mergeSuggestedAccessListHex(merged, {
      read: [`0x${'33'.repeat(32)}`],
      write: [],
    });
    expect(again.read).toHaveLength(3);
  });

  it('emptyAccessList stays empty without suggestions', () => {
    expect(mergeSuggestedAccessListHex(emptyAccessList(), null)).toEqual({ read: [], write: [] });
  });
});
