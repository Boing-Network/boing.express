import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearNodeCompatCache, compareSemver, evaluateNodeHealth } from '../src/boing/nodeCompat';
import { clearNetworkInfoCaches } from '../src/boing/networkInfo';
import { checkNodeCompat } from '../src/boing/nodeCompat';

const HEALTH = { chain_id: 6913, client_version: 'boing-node/0.1.0', tx_signing: { chain_id: 6913, v2_supported: true } };
const expected = { chainId: 6913 };

const hints = (h: Record<string, string>) => ({ ...HEALTH, client_hints: h });

describe('wallet version gate (client_hints.min_wallet_version)', () => {
  it('warns when the wallet is older than the node asks for', () => {
    const s = evaluateNodeHealth(hints({ min_wallet_version: '0.3.0' }), expected, 1, { version: '0.2.9' });
    expect(s.level).toBe('warn');
    expect(s.issues.map((i) => i.code)).toEqual(['wallet_too_old']);
    expect(s.issues[0].message).toContain('0.3.0');
  });
  it('is quiet when new enough, equal, or when the node says nothing', () => {
    expect(evaluateNodeHealth(hints({ min_wallet_version: '0.3.0' }), expected, 1, { version: '0.3.0' }).level).toBe('ok');
    expect(evaluateNodeHealth(hints({ min_wallet_version: '0.3.0' }), expected, 1, { version: '1.0.0' }).level).toBe('ok');
    expect(evaluateNodeHealth(HEALTH, expected, 1, { version: '0.0.1' }).level).toBe('ok');
  });
  it('never warns when this build does not know its own version', () => {
    expect(evaluateNodeHealth(hints({ min_wallet_version: '9.9.9' }), expected, 1).level).toBe('ok');
    expect(evaluateNodeHealth(hints({ min_wallet_version: 'soon' }), expected, 1, { version: '0.1.0' }).level).toBe('ok');
  });
  it('an explicit minWalletVersion (from boing_getNetworkInfo) is honoured', () => {
    expect(evaluateNodeHealth(HEALTH, expected, 1, { version: '0.1.0', minWalletVersion: '0.2.0' }).issues[0].code).toBe('wallet_too_old');
  });
});

describe('checkNodeCompat without a known wallet version', () => {
  beforeEach(() => {
    clearNodeCompatCache();
    clearNetworkInfoCaches();
  });
  afterEach(() => vi.unstubAllGlobals());
  it('makes no extra boing_getNetworkInfo call in unversioned builds (tests, dev)', async () => {
    const f = vi.fn(async (_u: string, init?: { body?: string }) => {
      const b = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: b.id, result: HEALTH }));
    });
    vi.stubGlobal('fetch', f);
    expect((await checkNodeCompat('https://rpc.test/v', expected)).level).toBe('ok');
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('recommended_wallet_version (advisory)', () => {
  const h = hints({ min_wallet_version: '0.1.15', recommended_wallet_version: '0.1.22' });
  it('is an info note that does not raise the level', () => {
    const s = evaluateNodeHealth(h, expected, 1, { version: '0.1.20' });
    expect(s.level).toBe('ok');
    expect(s.issues).toEqual([{ code: 'wallet_update_available', level: 'info', message: 'Boing Express 0.1.22 is available (you have 0.1.20).' }]);
  });
  it('is replaced by the warning when below the minimum, and silent when current', () => {
    expect(evaluateNodeHealth(h, expected, 1, { version: '0.1.14' }).issues.map((i) => i.code)).toEqual(['wallet_too_old']);
    expect(evaluateNodeHealth(h, expected, 1, { version: '0.1.22' }).issues).toEqual([]);
    expect(evaluateNodeHealth(h, expected, 1, { version: '0.2.0' }).issues).toEqual([]);
  });
  it('a real error still wins over the advisory', () => {
    const s = evaluateNodeHealth({ ...h, chain_id: 6914, tx_signing: { chain_id: 6914, v2_supported: true } }, expected, 1, { version: '0.1.20' });
    expect(s.level).toBe('error');
  });
});

describe('compareSemver', () => {
  it('orders core versions numerically, not lexically', () => {
    expect(compareSemver('0.1.9', '0.1.22')).toBe(-1);
    expect(compareSemver('1.0.0', '0.99.99')).toBe(1);
    expect(compareSemver('v0.1.22', '0.1.22')).toBe(0);
  });
  it('sorts a pre-release below its release and compares identifiers', () => {
    expect(compareSemver('0.1.22-rc.1', '0.1.22')).toBe(-1);
    expect(compareSemver('0.1.22-rc.2', '0.1.22-rc.10')).toBe(-1);
    expect(compareSemver('0.1.22-alpha', '0.1.22-1')).toBe(1);
    expect(compareSemver('0.1.22+build5', '0.1.22')).toBe(0);
  });
  it('is null for non-semver input', () => {
    expect(compareSemver('soon', '0.1.0')).toBeNull();
    expect(compareSemver('0.1', '0.1.0')).toBeNull();
  });
});

describe('checkNodeCompat reads client_hints from boing_health', () => {
  beforeEach(() => {
    clearNodeCompatCache();
    clearNetworkInfoCaches();
  });
  afterEach(() => vi.unstubAllGlobals());
  it('uses boing_health hints and makes no extra boing_getNetworkInfo call', async () => {
    const f = vi.fn(async (_u: string, init?: { body?: string }) => {
      const b = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: b.id, result: hints({ min_wallet_version: '0.1.15' }) }));
    });
    vi.stubGlobal('fetch', f);
    expect((await checkNodeCompat('https://rpc.test/h', expected)).level).toBe('ok');
    expect(f).toHaveBeenCalledTimes(1);
  });
});