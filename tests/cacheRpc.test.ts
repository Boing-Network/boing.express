import { describe, expect, it } from 'vitest';
import { cacheKeySourceString, stripJsonRpcIds } from '../workers/rpc-gateway/src/cacheRpc';

describe('rpc gateway cache key', () => {
  it('strips id from single and batch JSON-RPC for stable cache keys', () => {
    const a = { jsonrpc: '2.0', id: 1, method: 'boing_health', params: [] };
    const b = { jsonrpc: '2.0', id: 99, method: 'boing_health', params: [] };
    expect(cacheKeySourceString(a)).toBe(cacheKeySourceString(b));

    const batchA = [
      { jsonrpc: '2.0', id: 1, method: 'boing_listDexPools', params: [{ limit: 2 }] },
    ];
    const batchB = [
      { jsonrpc: '2.0', id: 'x', method: 'boing_listDexPools', params: [{ limit: 2 }] },
    ];
    expect(cacheKeySourceString(batchA)).toBe(cacheKeySourceString(batchB));
  });

  it('stripJsonRpcIds preserves non-id fields', () => {
    expect(stripJsonRpcIds({ jsonrpc: '2.0', id: 1, method: 'boing_health', params: [] })).toEqual({
      jsonrpc: '2.0',
      method: 'boing_health',
      params: [],
    });
  });
});
