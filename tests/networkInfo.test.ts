import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearNetworkInfoCaches,
  fetchFeePolicy,
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
      min_wallet_version: '0.4.0',
      recommended_sdk: '0.5.38',
    });
    expect(m).toMatchObject({
      chainId: 6913,
      chainName: 'Boing Testnet',
      explorerUrl: 'https://boing.observer',
      faucetUrl: 'https://faucet.example',
      minWalletVersion: '0.4.0',
      recommendedSdk: '0.5.38',
    });
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