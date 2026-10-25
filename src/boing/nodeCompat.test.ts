import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkNodeCompat,
  clearNodeCompatCache,
  compareVersions,
  configuredChainIdDecimal,
  evaluateNodeHealth,
  parseNodeVersion,
} from './nodeCompat';

/** Trimmed copy of a real `boing_health` response from https://testnet-rpc.boing.network (2026-10-25). */
const TESTNET_HEALTH = {
  chain_id: 6913,
  chain_name: 'Boing Testnet',
  client_version: 'boing-node/0.1.0',
  ok: true,
  rpc_surface: { tx_batch_max_calls: 16, tx_payload_batch: true },
  tx_signing: { chain_id: 6913, domain: 'BOING_TX_V2', v2_from_height: 900, v2_required: true, v2_supported: true },
};

describe('evaluateNodeHealth', () => {
  it('is ok for a matching node and reports capabilities', () => {
    const s = evaluateNodeHealth(TESTNET_HEALTH, { chainId: 6913, networkName: 'Boing Testnet' });
    expect(s.level).toBe('ok');
    expect(s.issues).toEqual([]);
    expect(s.nodeChainId).toBe(6913);
    expect(s.clientVersion).toBe('boing-node/0.1.0');
    expect(s.v2Signing).toBe(true);
    expect(s.txBatch).toBe(true);
  });

  it('blocks on chain id mismatch (mainnet node behind testnet selection)', () => {
    const s = evaluateNodeHealth(
      { ...TESTNET_HEALTH, chain_id: 6914, tx_signing: { ...TESTNET_HEALTH.tx_signing, chain_id: 6914 } },
      { chainId: 6913, networkName: 'Boing Testnet' }
    );
    expect(s.level).toBe('error');
    expect(s.issues[0].code).toBe('chain_mismatch');
    expect(s.issues[0].message).toContain('6914');
  });

  it('flags a signing-domain chain id that differs from the configured one', () => {
    const s = evaluateNodeHealth(
      { ...TESTNET_HEALTH, tx_signing: { ...TESTNET_HEALTH.tx_signing, chain_id: 9999 } },
      { chainId: 6913 }
    );
    expect(s.level).toBe('error');
    expect(s.issues[0].message).toContain('9999');
  });

  it('warns when the node reports no chain id but the network is configured with one', () => {
    const s = evaluateNodeHealth({ ok: true, client_version: 'boing-node/0.1.0' }, { chainId: 6913 });
    expect(s.level).toBe('warn');
    expect(s.issues[0].code).toBe('no_chain_id');
  });

  it('does not require a chain id on local dev networks without one', () => {
    expect(evaluateNodeHealth({ ok: true }, { chainId: null }).level).toBe('ok');
  });

  it('errors when v2 is required but not supported', () => {
    const s = evaluateNodeHealth({ ...TESTNET_HEALTH, tx_signing: { chain_id: 6913, v2_required: true, v2_supported: false } }, { chainId: 6913 });
    expect(s.issues.some((i) => i.code === 'signing_v2_unsupported')).toBe(true);
    expect(s.level).toBe('error');
  });

  it('warns for nodes older than the tested version', () => {
    const s = evaluateNodeHealth({ ...TESTNET_HEALTH, client_version: 'boing-node/0.0.9' }, { chainId: 6913 });
    expect(s.level).toBe('warn');
    expect(s.issues[0].code).toBe('node_too_old');
  });

  it('treats non-object health as unreachable', () => {
    expect(evaluateNodeHealth(null, { chainId: 6913 }).issues[0].code).toBe('unreachable');
  });
});

describe('helpers', () => {
  it('parses versions and chain ids', () => {
    expect(parseNodeVersion('boing-node/0.1.0')).toEqual([0, 1, 0]);
    expect(parseNodeVersion('nope')).toBeNull();
    expect(compareVersions([0, 1, 0], [0, 2, 0])).toBe(-1);
    expect(compareVersions([1, 0, 0], [0, 9, 9])).toBe(1);
    expect(configuredChainIdDecimal('0x1b01')).toBe(6913);
    expect(configuredChainIdDecimal('6914')).toBe(6914);
    expect(configuredChainIdDecimal(undefined)).toBeNull();
    expect(configuredChainIdDecimal('0xzz')).toBeNull();
  });
});

describe('checkNodeCompat', () => {
  beforeEach(() => {
    clearNodeCompatCache();
    vi.restoreAllMocks();
  });

  it('probes boing_health once and caches the result', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: TESTNET_HEALTH }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const a = await checkNodeCompat('https://rpc.example', { chainId: 6913 });
    const b = await checkNodeCompat('https://rpc.example', { chainId: 6913 });
    expect(a.level).toBe('ok');
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.method).toBe('boing_health');
  });

  it('never throws on network failure and retries quickly', async () => {
    let t = 1_000;
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Failed to fetch'); }));
    const first = await checkNodeCompat('https://down.example', { chainId: 6913 }, { now: () => t });
    expect(first.issues[0].code).toBe('unreachable');
    t += 6_000;
    const fetchOk = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: TESTNET_HEALTH }), { status: 200 }));
    vi.stubGlobal('fetch', fetchOk);
    const second = await checkNodeCompat('https://down.example', { chainId: 6913 }, { now: () => t });
    expect(second.level).toBe('ok');
  });
});