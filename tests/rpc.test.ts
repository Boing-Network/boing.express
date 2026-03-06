import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBalance, getNonce, isMethodNotFoundError, rpcCall, RpcClientError } from '../src/boing/rpc';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('rpc client', () => {
  it('preserves JSON-RPC method-not-found errors as typed client errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32601, message: 'Method not found' },
        }),
      })
    );

    let thrown: unknown;
    try {
      await rpcCall('https://testnet-rpc.boing.network', 'boing_getAccount', ['0xabc']);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RpcClientError);
    expect((thrown as RpcClientError).code).toBe(-32601);
    expect(isMethodNotFoundError(thrown)).toBe(true);
  });

  it('does not convert transport failures into zero balances or nonces', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));

    await expect(getBalance('https://testnet-rpc.boing.network', '0xabc')).rejects.toThrow(
      'Network unavailable or RPC not responding. Check your connection and try again.'
    );
    await expect(getNonce('https://testnet-rpc.boing.network', '0xabc')).rejects.toThrow(
      'Network unavailable or RPC not responding. Check your connection and try again.'
    );
  });
});
