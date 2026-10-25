import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearNodeCompatCache, evaluateNodeHealth } from '../src/boing/nodeCompat';
import { clearNetworkInfoCaches } from '../src/boing/networkInfo';
import { checkNodeCompat } from '../src/boing/nodeCompat';

const HEALTH = { chain_id: 6913, client_version: 'boing-node/0.1.0', tx_signing: { chain_id: 6913, v2_supported: true } };
const expected = { chainId: 6913 };

describe('wallet version gate (min_wallet_version)', () => {
  it('warns when the wallet is older than the node asks for', () => {
    const s = evaluateNodeHealth({ ...HEALTH, min_wallet_version: '0.3.0' }, expected, 1, { version: '0.2.9' });
    expect(s.level).toBe('warn');
    expect(s.issues.map((i) => i.code)).toEqual(['wallet_too_old']);
    expect(s.issues[0].message).toContain('0.3.0');
  });
  it('is quiet when new enough, equal, or when the node says nothing', () => {
    expect(evaluateNodeHealth({ ...HEALTH, min_wallet_version: '0.3.0' }, expected, 1, { version: '0.3.0' }).level).toBe('ok');
    expect(evaluateNodeHealth({ ...HEALTH, min_wallet_version: '0.3.0' }, expected, 1, { version: '1.0.0' }).level).toBe('ok');
    expect(evaluateNodeHealth(HEALTH, expected, 1, { version: '0.0.1' }).level).toBe('ok');
  });
  it('never warns when this build does not know its own version', () => {
    expect(evaluateNodeHealth({ ...HEALTH, min_wallet_version: '9.9.9' }, expected, 1).level).toBe('ok');
    expect(evaluateNodeHealth({ ...HEALTH, min_wallet_version: 'soon' }, expected, 1, { version: '0.1.0' }).level).toBe('ok');
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