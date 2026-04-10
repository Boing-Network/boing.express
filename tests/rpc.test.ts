import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getBalance,
  getNonce,
  isMethodNotFoundError,
  rpcCall,
  RpcClientError,
  simulateContractCall,
} from '../src/boing/rpc';

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

  it('preserves JSON-RPC error.data from the node (W2)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32050,
            message: 'Deployment rejected by QA: test rule',
            data: { rule_id: 'R_TEST', doc_url: 'https://example.invalid/doc' },
          },
        }),
      })
    );

    let thrown: unknown;
    try {
      await rpcCall('https://testnet-rpc.boing.network', 'boing_submitTransaction', ['0x00']);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RpcClientError);
    expect((thrown as RpcClientError).code).toBe(-32050);
    expect((thrown as RpcClientError).message).toContain('Deployment rejected');
    expect((thrown as RpcClientError).data).toEqual({
      rule_id: 'R_TEST',
      doc_url: 'https://example.invalid/doc',
    });
  });

  it('calls boing_simulateContractCall with given params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: { success: true },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await simulateContractCall('https://rpc.example/rpc', [
      '0x' + 'aa'.repeat(32),
      '0x',
      '0x' + 'bb'.repeat(32),
      123,
    ]);
    expect(out).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.method).toBe('boing_simulateContractCall');
    expect(body.params).toEqual([
      '0x' + 'aa'.repeat(32),
      '0x',
      '0x' + 'bb'.repeat(32),
      123,
    ]);
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
