import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NetworkConfig } from '../src/networks/types';
import { createBoingAdapter } from '../src/networks/boingAdapter';
import * as rpc from '../src/boing/rpc';

const accountId = new Uint8Array(32);
const baseConfig: NetworkConfig = {
  id: 'boing-testnet',
  name: 'Boing Testnet',
  rpcUrl: 'https://testnet-rpc.boing.network',
  isTestnet: true,
  explorerUrl: 'https://boing.observer',
  faucetUrl: 'https://boing.network/faucet',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createBoingAdapter', () => {
  it('falls back to boing_getBalance only when boing_getAccount is unavailable', async () => {
    vi.spyOn(rpc, 'getAccount').mockRejectedValue(new rpc.RpcClientError('Method not found', -32601));
    vi.spyOn(rpc, 'getBalance').mockResolvedValue('42');

    const adapter = createBoingAdapter(baseConfig);
    const balance = await adapter.getBalance(accountId);

    expect(balance.value).toBe('42');
    expect(rpc.getBalance).toHaveBeenCalledOnce();
  });

  it('surfaces real boing_getAccount failures instead of masking them', async () => {
    vi.spyOn(rpc, 'getAccount').mockRejectedValue(new Error('RPC offline'));
    const getBalanceSpy = vi.spyOn(rpc, 'getBalance');

    const adapter = createBoingAdapter(baseConfig);

    await expect(adapter.getBalance(accountId)).rejects.toThrow('RPC offline');
    expect(getBalanceSpy).not.toHaveBeenCalled();
  });

  it('does not submit when simulate returns success: false', async () => {
    vi.spyOn(rpc, 'simulateTransaction').mockResolvedValue({
      success: false,
      error: 'insufficient balance',
    });
    const submitSpy = vi.spyOn(rpc, 'submitTransaction');

    const adapter = createBoingAdapter(baseConfig);
    const result = await adapter.submitTransaction('0x00');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/insufficient balance/i);
    expect(submitSpy).not.toHaveBeenCalled();
  });
});
