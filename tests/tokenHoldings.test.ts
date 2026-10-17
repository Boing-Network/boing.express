import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/boing/rpc', () => ({ listDexTokens: vi.fn(), getContractStorage: vi.fn(), getDexToken: vi.fn() }));

import * as rpc from '../src/boing/rpc';
import { loadTokenHoldings } from '../src/boing/tokenHoldings';

const ME = 'aa'.repeat(32);
const T1 = '01'.repeat(32);
const T2 = '02'.repeat(32);
const T3 = '03'.repeat(32);

afterEach(() => vi.resetAllMocks());

describe('loadTokenHoldings', () => {
  it('merges watchlist + DEX directory, hides zero directory balances, keeps watched zeros', async () => {
    vi.mocked(rpc.listDexTokens).mockResolvedValue({
      tokens: [
        { id: `0x${T2}`, symbol: 'USDB', name: 'USD Boing', decimals: 2 },
        { id: `0x${T3}`, symbol: 'ZERO', decimals: 0 },
      ],
    });
    vi.mocked(rpc.getContractStorage).mockImplementation(async (_url, contract) => {
      if (contract === T2) return `0x${(12345).toString(16).padStart(64, '0')}`;
      return `0x${'0'.repeat(64)}`;
    });
    const h = await loadTokenHoldings({ rpcUrl: 'x', ownerHex: ME, watchlist: [{ tokenHex: T1, symbol: 'MINE', addedAt: 0 }] });
    expect(h.map((x) => [x.symbol, x.balanceDisplay, x.watched])).toEqual([
      ['MINE', '0', true],
      ['USDB', '123.45', false],
    ]);
  });
  it('survives a missing DEX directory', async () => {
    vi.mocked(rpc.listDexTokens).mockRejectedValue(new Error('Method not found'));
    vi.mocked(rpc.getContractStorage).mockRejectedValue(new Error('down'));
    const h = await loadTokenHoldings({ rpcUrl: 'x', ownerHex: ME, watchlist: [{ tokenHex: T1, addedAt: 0 }] });
    expect(h).toHaveLength(1);
    expect(h[0]!.balanceRaw).toBeNull();
    expect(h[0]!.error).toBe('down');
  });
});

describe('loadTokenHoldings with light directory rows', () => {
  const FV2C = '31357854f6371c8bafac0ff20296608d87db532bef06de8066d1fdd32c824b4e';
  const balanceWord = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

  it('replaces placeholder labels with deploy metadata and uses the token decimals (0 for v2), not 18', async () => {
    vi.mocked(rpc.listDexTokens).mockResolvedValue({
      tokens: [{ id: `0x${FV2C}`, symbol: '0x31357854…824b4e', name: 'Pool token 0x31357854f6', decimals: 0, metadataSource: 'abbrev' }],
    });
    vi.mocked(rpc.getContractStorage).mockResolvedValue(balanceWord(997766));
    vi.mocked(rpc.getDexToken).mockResolvedValue({
      id: `0x${FV2C}`, symbol: 'FV2C', name: 'FinV2Check', decimals: 0, decimalsSource: 'template', metadataSource: 'deploy',
    });
    const h = await loadTokenHoldings({ rpcUrl: 'x', ownerHex: ME, watchlist: [] });
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ symbol: 'FV2C', name: 'FinV2Check', decimals: 0, balanceRaw: '997766', balanceDisplay: '997766' });
    expect(vi.mocked(rpc.getDexToken)).toHaveBeenCalledWith('x', [{ id: `0x${FV2C}` }]);
  });

  it('unknown decimals (null) show whole units instead of dividing by a guessed 18', async () => {
    vi.mocked(rpc.listDexTokens).mockResolvedValue({
      tokens: [{ id: `0x${FV2C}`, symbol: '0x31357854…824b4e', decimals: null, metadataSource: 'abbrev' }],
    });
    vi.mocked(rpc.getContractStorage).mockResolvedValue(balanceWord(1234));
    vi.mocked(rpc.getDexToken).mockResolvedValue({ id: `0x${FV2C}`, symbol: 'NEW', name: 'New', decimals: null, metadataSource: 'deploy' });
    const h = await loadTokenHoldings({ rpcUrl: 'x', ownerHex: ME, watchlist: [] });
    expect(h[0]).toMatchObject({ symbol: 'NEW', decimals: 0, balanceDisplay: '1234' });
  });

  it('keeps the watchlist symbol and decimals and does not hit the node for them', async () => {
    vi.mocked(rpc.listDexTokens).mockResolvedValue({ tokens: [] });
    vi.mocked(rpc.getContractStorage).mockResolvedValue(balanceWord(500));
    const h = await loadTokenHoldings({ rpcUrl: 'x', ownerHex: ME, watchlist: [{ tokenHex: FV2C, symbol: 'MINE', decimals: 2, addedAt: 0 }] });
    expect(h[0]).toMatchObject({ symbol: 'MINE', balanceDisplay: '5' });
    expect(vi.mocked(rpc.getDexToken)).not.toHaveBeenCalled();
  });

  it('tolerates a failing getDexToken', async () => {
    vi.mocked(rpc.listDexTokens).mockResolvedValue({ tokens: [{ id: `0x${FV2C}`, symbol: '0x31357854…824b4e', metadataSource: 'abbrev' }] });
    vi.mocked(rpc.getContractStorage).mockResolvedValue(balanceWord(7));
    vi.mocked(rpc.getDexToken).mockRejectedValue(new Error('down'));
    const h = await loadTokenHoldings({ rpcUrl: 'x', ownerHex: ME, watchlist: [] });
    expect(h[0]).toMatchObject({ decimals: 0, balanceDisplay: '7' });
    expect(h[0]!.symbol).not.toContain('Pool token');
  });
});
