import { describe, expect, it } from 'vitest';
import {
  isLegacyVaultV1,
  migrateVaultToV2,
  parseVaultFromStoredJson,
  getActiveAddressHex,
  vaultToStoredJson,
} from '../src/storage/walletVault';

describe('walletVault', () => {
  it('detects legacy v1', () => {
    expect(isLegacyVaultV1({ encrypted: 'x', addressHex: 'ab'.repeat(32) })).toBe(true);
    expect(isLegacyVaultV1({ version: 2, accounts: [] })).toBe(false);
  });

  it('migrates v1 to v2', () => {
    const v = migrateVaultToV2({ encrypted: 'enc', addressHex: 'Cd'.repeat(32) });
    expect(v.version).toBe(2);
    expect(v.accounts).toHaveLength(1);
    expect(v.accounts[0].addressHex).toBe('cd'.repeat(32));
    expect(v.activeIndex).toBe(0);
  });

  it('round-trips v2 JSON', () => {
    const v2 = {
      version: 2 as const,
      activeIndex: 1,
      accounts: [
        { encrypted: 'a', addressHex: '11'.repeat(32) },
        { encrypted: 'b', addressHex: '22'.repeat(32) },
      ],
    };
    const raw = vaultToStoredJson(v2);
    const parsed = parseVaultFromStoredJson(raw);
    expect(parsed.activeIndex).toBe(1);
    expect(getActiveAddressHex(parsed)).toBe('22'.repeat(32));
  });
});
