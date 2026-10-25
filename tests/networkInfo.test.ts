import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearNetworkInfoCaches,
  fetchFeePolicy,
  fetchTipSupport,
  fetchNetworkInfoMeta,
  mergeNetworkInfo,
  parseFeePolicy,
  parseNetworkInfo,
} from '../src/boing/networkInfo';

describe('parseNetworkInfo', () => {
  it('reads chain, explorer and optional wallet requirements', () => {
    const m = parseNetworkInfo({
      chain_id: 6913,
      chain_name: 'Boing Testnet',
      client_version: 'x',
      end_user: { explorer_url: 'https://boing.observer/', faucet_url: 'https://faucet.example/' },
      client_hints: { min_wallet_version: '0.4.0', recommended_wallet_version: '0.4.2', recommended_sdk: '0.5.38', sdk_npm_package: '@boing-network/boing-sdk', note: 'Advisory only' },
      tx_signing: { priority_tips_supported: true, priority_tip_domain: 'BOING_TX_PRIORITY' },
    });
    expect(m).toMatchObject({
      chainId: 6913,
      chainName: 'Boing Testnet',
      explorerUrl: 'https://boing.observer',
      faucetUrl: 'https://faucet.example',
      minWalletVersion: '0.4.0',
      recommendedWalletVersion: '0.4.2',
      recommendedSdk: '0.5.38',
      sdkNpmPackage: '@boing-network/boing-sdk',
      priorityTipsSupported: true,
      priorityTipDomain: 'BOING_TX_PRIORITY',
    });
  });
  it('reads only the documented shape: client_hints.* (top-level and wallet.* guesses are ignored)', () => {
    const m = parseNetworkInfo({ min_wallet_version: '0.4.0', recommended_sdk: '0.5.0', wallet: { min_wallet_version: '0.4.0' } });
    expect(m.minWalletVersion).toBeUndefined();
    expect(m.recommendedSdk).toBeUndefined();
  });
  it('drops hints that are not semver, strips a leading v, keeps pre-releases', () => {
    const m = parseNetworkInfo({ client_hints: { min_wallet_version: 'soon', recommended_wallet_version: 'v0.2.0', recommended_sdk: '1.0.0-rc.1' } });
    expect(m.minWalletVersion).toBeUndefined();
    expect(m.recommendedWalletVersion).toBe('0.2.0');
    expect(m.recommendedSdk).toBe('1.0.0-rc.1');
  });
  it('priority_tips_supported is only read when it is a boolean', () => {
    expect(parseNetworkInfo({ tx_signing: { priority_tips_supported: false } }).priorityTipsSupported).toBe(false);
    expect(parseNetworkInfo({ tx_signing: { priority_tips_supported: 'yes' } }).priorityTipsSupported).toBeUndefined();
    expect(parseNetworkInfo({}).priorityTipsSupported).toBeUndefined();
  });
  it('parses the real boing.network example shape from docs/RPC-API-SPEC.md (boing_health)', () => {
    const m = parseNetworkInfo({
      ok: true, client_version: 'boing-node/0.1.0', chain_id: 6913, chain_name: 'Boing Testnet', head_height: 42,
      tx_signing: { v2_supported: true, domain: 'BOING_TX_V2', chain_id: 6913, priority_tips_supported: true, priority_tip_domain: 'BOING_TX_PRIORITY' },
      client_hints: { min_wallet_version: '0.1.15', recommended_wallet_version: '0.1.22', recommended_sdk: '0.5.38', sdk_npm_package: '@boing-network/boing-sdk', note: 'Advisory only ...' },
    });
    expect(m).toMatchObject({ chainId: 6913, minWalletVersion: '0.1.15', recommendedWalletVersion: '0.1.22', recommendedSdk: '0.5.38', priorityTipsSupported: true });
  });
  it('tolerates absence, nulls and junk', () => {
    expect(parseNetworkInfo(null)).toEqual({});
    expect(parseNetworkInfo('x')).toEqual({});
    const m = parseNetworkInfo({ chain_id: null, end_user: { explorer_url: null } });
    expect(m.chainId).toBeUndefined();
    expect(m.explorerUrl).toBeUndefined();
    expect(m.minWalletVersion).toBeUndefined();
  });
  it('rejects non-http explorer urls', () => {
    expect(parseNetworkInfo({ end_user: { explorer_url: 'javascript:alert(1)' } }).explorerUrl).toBeUndefined();
  });
  it('merges with first defined winning', () => {
    expect(mergeNetworkInfo({ chainId: 1 }, { chainId: 2, chainName: 'n' })).toEqual({ chainId: 1, chainName: 'n' });
  });
});

describe('parseFeePolicy', () => {
  it('allows tips unless the node says optional_priority_tips is false', () => {
    expect(parseFeePolicy({}).tipsAllowed).toBe(true);
    expect(parseFeePolicy({ optional_priority_tips: true }).tipsAllowed).toBe(true);
    expect(parseFeePolicy({ optional_priority_tips: false }).tipsAllowed).toBe(false);
  });
  it('reads bps and gas price fields', () => {
    const p = parseFeePolicy({ gas_price_base_units: '1000', micro_fee_execution_gas_bps: 10, tip_burn_bps: '2500' });
    expect(p).toMatchObject({ known: true, gasPriceBaseUnits: 1000n, microFeeExecutionGasBps: 10, tipBurnBps: 2500 });
  });
  it('non-objects are the unknown fallback (tips stay available)', () => {
    expect(parseFeePolicy(undefined)).toMatchObject({ known: false, tipsAllowed: true });
  });
});

describe('fetchTipSupport', () => {
  const stub = (health: unknown, policy: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: { body?: string }) => {
        const b = JSON.parse(String(init?.body ?? '{}'));
        const result = b.method === 'boing_health' ? health : policy;
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: b.id, result }));
      }),
    );
  beforeEach(() => clearNetworkInfoCaches());
  afterEach(() => vi.unstubAllGlobals());

  it('allows tips when everything is true or unknown', async () => {
    stub({ tx_signing: { priority_tips_supported: true, priority_tip_domain: 'BOING_TX_PRIORITY' } }, { optional_priority_tips: true });
    expect(await fetchTipSupport('https://rpc.test/t1')).toEqual({ allowed: true });
    stub({}, {});
    expect(await fetchTipSupport('https://rpc.test/t2')).toEqual({ allowed: true });
  });
  it('blocks on an explicit no from the fee policy, the signing info, or a different domain', async () => {
    stub({}, { optional_priority_tips: false });
    expect(await fetchTipSupport('https://rpc.test/t3')).toEqual({ allowed: false, reason: 'policy' });
    stub({ tx_signing: { priority_tips_supported: false } }, {});
    expect(await fetchTipSupport('https://rpc.test/t4')).toEqual({ allowed: false, reason: 'unsupported' });
    stub({ tx_signing: { priority_tips_supported: true, priority_tip_domain: 'BOING_TX_OTHER' } }, {});
    expect(await fetchTipSupport('https://rpc.test/t5')).toEqual({ allowed: false, reason: 'domain' });
  });
  it('an unreachable node keeps tips available (unknown, not no)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await fetchTipSupport('https://rpc.test/t6')).toEqual({ allowed: true });
  });
});

describe('cached fetchers', () => {
  const rpc = (handler: (method: string) => unknown) =>
    vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const out = handler(body.method);
      if (out instanceof Error) return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: out.message } }));
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: out }));
    });
  beforeEach(() => clearNetworkInfoCaches());
  afterEach(() => vi.unstubAllGlobals());

  it('caches the fee policy per rpc url', async () => {
    const f = rpc(() => ({ optional_priority_tips: false }));
    vi.stubGlobal('fetch', f);
    expect((await fetchFeePolicy('https://rpc.test/a')).tipsAllowed).toBe(false);
    expect((await fetchFeePolicy('https://rpc.test/a')).tipsAllowed).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('never throws: an old node (method not found) yields the unknown policy and empty info', async () => {
    vi.stubGlobal('fetch', rpc(() => new Error('Method not found')));
    expect(await fetchFeePolicy('https://rpc.test/old')).toMatchObject({ known: false, tipsAllowed: true });
    expect(await fetchNetworkInfoMeta('https://rpc.test/old')).toEqual({});
  });
});