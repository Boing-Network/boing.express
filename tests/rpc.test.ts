import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAccount,
  getBalance,
  getContractStorage,
  isMethodNotFoundError,
  listDexPools,
  parseSubmitTransactionResult,
  rpcCall,
  RpcClientError,
  RPC_EDGE_RATE_LIMIT_MESSAGE,
  simulateContractCall,
  submitTransaction,
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

  it('sends boing_listDexPools with one object param (SDK-shaped)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: { pools: [], nextCursor: null },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await listDexPools('https://rpc.example/rpc', []);
    let body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.method).toBe('boing_listDexPools');
    expect(body.params).toEqual([{}]);

    await listDexPools('https://rpc.example/rpc', [{ cursor: '0xab', limit: 10 }]);
    body = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body);
    expect(body.params).toEqual([{ cursor: '0xab', limit: 10 }]);
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

  it('calls boing_getContractStorage with 0x-prefixed contract and key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: { value: '0x' + '11'.repeat(32) },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const contract = 'aa'.repeat(32);
    const key = 'bb'.repeat(32);
    const out = await getContractStorage('https://rpc.example/rpc', contract, key);
    expect(out).toEqual({ value: '0x' + '11'.repeat(32) });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.method).toBe('boing_getContractStorage');
    expect(body.params).toEqual([`0x${contract}`, `0x${key}`]);
  });

  it('parses boing_submitTransaction object result per RPC spec', () => {
    expect(parseSubmitTransactionResult({ tx_hash: 'ok' })).toBe('ok');
    expect(parseSubmitTransactionResult({ tx_hash: '0xabc' })).toBe('0xabc');
    expect(parseSubmitTransactionResult('legacy-string')).toBe('legacy-string');
    expect(() => parseSubmitTransactionResult({})).toThrow(RpcClientError);
  });

  it('submitTransaction extracts tx_hash from JSON-RPC result object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: { tx_hash: 'ok' },
        }),
      })
    );

    await expect(submitTransaction('https://testnet-rpc.boing.network', '0x00')).resolves.toBe('ok');
  });

  it('does not convert transport failures into zero balances or nonces', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));

    await expect(getBalance('https://testnet-rpc.boing.network', '0xabc')).rejects.toThrow(
      'Network unavailable or RPC not responding. Check your connection and try again.'
    );
    await expect(getAccount('https://testnet-rpc.boing.network', '0xabc')).rejects.toThrow(
      'Network unavailable or RPC not responding. Check your connection and try again.'
    );
  });

  it('retries HTTP 429 then returns the result', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: '',
        headers: { get: () => null },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: { transactions: [], next_cursor: null } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const pending = rpcCall('https://testnet-rpc.boing.network', 'boing_getAccountTransactions', [
      '0xabc',
      { cursor: null, limit: 25 },
    ]);
    await vi.advanceTimersByTimeAsync(2_500);
    await expect(pending).resolves.toEqual({ transactions: [], next_cursor: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('surfaces a clear rate-limit message after exhausted 429 retries', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: '',
      headers: { get: () => '2' },
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = rpcCall('https://testnet-rpc.boing.network', 'boing_getAccountTransactions', [
      '0xabc',
      { cursor: null, limit: 25 },
    ]).then(
      () => null,
      (e: unknown) => e
    );
    // Three attempts: waits after 1st and 2nd (Retry-After 2s each).
    await vi.advanceTimersByTimeAsync(5_000);
    const thrown = await pending;
    expect(thrown).toBeInstanceOf(RpcClientError);
    expect((thrown as RpcClientError).message).toBe(RPC_EDGE_RATE_LIMIT_MESSAGE);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('retries transient 5xx once then succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: { get: () => null },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: 'ok' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const pending = rpcCall('https://testnet-rpc.boing.network', 'boing_health', []);
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(pending).resolves.toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
