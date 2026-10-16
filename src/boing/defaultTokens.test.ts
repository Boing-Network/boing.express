import { describe, expect, it } from 'vitest';
import { defaultTokensForChainId, mergeWithDefaultTokens } from './defaultTokens';

const USDC = '6676f971ade3982406efa3e2cdb0477923f8f2a15624c4b6ad3a432817a75e93';
const BOING = '6fce9d3e3f13df9fc17e3fd947148a4e6ce6966538b7dd9bf2a891d3b9699c6b';

describe('defaultTokens', () => {
  it('lists testnet USDC and tBOING for chain 6913 (hex or decimal)', () => {
    for (const id of ['0x1b01', 6913, '6913']) {
      expect(defaultTokensForChainId(id).map((t) => [t.tokenHex, t.symbol, t.decimals])).toEqual([
        [USDC, 'USDC', 0],
        [BOING, 'tBOING', 0],
      ]);
    }
  });
  it('has no defaults for other chains', () => {
    expect(defaultTokensForChainId('0x1b02')).toEqual([]);
    expect(defaultTokensForChainId(undefined)).toEqual([]);
  });
  it('keeps the user watch entry over the default', () => {
    const merged = mergeWithDefaultTokens([{ tokenHex: USDC, symbol: 'MYUSDC', decimals: 0, addedAt: 1 }], '0x1b01');
    expect(merged.map((m) => m.symbol)).toEqual(['MYUSDC', 'tBOING']);
  });
});