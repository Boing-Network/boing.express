import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearNodeCompatCache } from '../src/boing/nodeCompat';
import type { NetworkConfig } from '../src/networks/types';
import { createBoingAdapter } from '../src/networks/boingAdapter';
import * as ed from '@noble/ed25519';
import * as rpc from '../src/boing/rpc';
import * as nativeUnit from '../src/boing/nativeUnit';

const accountId = new Uint8Array(32);
const baseConfig: NetworkConfig = {
  id: 'boing-testnet',
  name: 'Boing Testnet',
  rpcUrl: 'https://testnet-rpc.boing.network',
  isTestnet: true,
  explorerUrl: 'https://boing.observer',
  faucetUrl: 'https://boing.network/faucet',
};

function stubHealth(chainId: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            ok: true,
            chain_id: chainId,
            client_version: 'boing-node/0.1.0',
            tx_signing: { chain_id: chainId, v2_required: true, v2_supported: true },
          },
        }),
        { status: 200 }
      )
    )
  );
}

beforeEach(() => {
  clearNodeCompatCache();
  stubHealth(6913);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createBoingAdapter', () => {
  it('falls back to boing_getBalance only when boing_getAccount is unavailable', async () => {
    vi.spyOn(rpc, 'getAccount').mockRejectedValue(new rpc.RpcClientError('Method not found', -32601));
    vi.spyOn(rpc, 'getBalance').mockResolvedValue('42');
    // Avoid a real boing_getNetworkInfo round-trip (can hang CI when RPC is slow).
    vi.spyOn(nativeUnit, 'currentLedgerDecimals').mockResolvedValue(18);

    const adapter = createBoingAdapter(baseConfig);
    const balance = await adapter.getBalance(accountId);

    expect(balance.value).toBe('42');
    expect(balance.decimals).toBe(18);
    expect(rpc.getBalance).toHaveBeenCalledOnce();
  });

  it('surfaces real boing_getAccount failures instead of masking them', async () => {
    vi.spyOn(rpc, 'getAccount').mockRejectedValue(new Error('RPC offline'));
    const getBalanceSpy = vi.spyOn(rpc, 'getBalance');

    const adapter = createBoingAdapter(baseConfig);

    await expect(adapter.getBalance(accountId)).rejects.toThrow('RPC offline');
    expect(getBalanceSpy).not.toHaveBeenCalled();
  });

  it('reads the nonce from boing_getAccount', async () => {
    vi.spyOn(rpc, 'getAccount').mockResolvedValue({ balance: '1', nonce: '9' });
    const adapter = createBoingAdapter(baseConfig);
    await expect(adapter.getNonce(accountId)).resolves.toBe(9n);
  });

  it('does not fall back to a nonce RPC when boing_getAccount is unavailable', async () => {
    vi.spyOn(rpc, 'getAccount').mockRejectedValue(new rpc.RpcClientError('Method not found', -32601));
    const adapter = createBoingAdapter(baseConfig);
    await expect(adapter.getNonce(accountId)).rejects.toThrow('Method not found');
  });

  it('does not submit when simulate returns success: false', async () => {
    vi.spyOn(rpc, 'simulateTransaction').mockResolvedValue({
      success: false,
      error: 'insufficient balance',
    });
    const submitSpy = vi.spyOn(rpc, 'submitTransactionDetailed');

    const adapter = createBoingAdapter(baseConfig);
    const result = await adapter.submitTransaction('0x00');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/balance is too low/i);
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('refuses to broadcast when the node reports a different chain id than the selected network', async () => {
    stubHealth(6914);
    const simSpy = vi.spyOn(rpc, 'simulateTransaction');
    const submitSpy = vi.spyOn(rpc, 'submitTransactionDetailed');
    const adapter = createBoingAdapter({ ...baseConfig, chainId: '0x1b01' });
    const result = await adapter.submitTransaction('0x00');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/6914/);
    expect(simSpy).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('encodes native value on batched contract calls (ContractCallWithValue) instead of dropping it', async () => {
    const sk = new Uint8Array(32).fill(7);
    const sender = await ed.getPublicKeyAsync(sk);
    const adapter = createBoingAdapter({ ...baseConfig, chainId: '0x1b01' });
    const contractHex = '0x' + '11'.repeat(32);
    const calldata = new Uint8Array([1, 2, 3]);
    const plain = await adapter.buildBatch!(sender, [{ kind: 'contractCall', contractHex, calldata }], 0n, sk);
    const zero = await adapter.buildBatch!(sender, [{ kind: 'contractCall', contractHex, calldata, value: 0n }], 0n, sk);
    const valued = await adapter.buildBatch!(sender, [{ kind: 'contractCall', contractHex, calldata, value: 5n }], 0n, sk);
    expect(zero).toBe(plain);
    expect(valued).not.toBe(plain);
    // ContractCallWithValue adds a u128 (16 bytes = 32 hex chars) to the step.
    expect(valued.length - plain.length).toBe(32);
  });

  it('maps node QA rejections to a readable message', async () => {
    vi.spyOn(rpc, 'simulateTransaction').mockResolvedValue({ success: true });
    vi.spyOn(rpc, 'submitTransactionDetailed').mockRejectedValue(
      new rpc.RpcClientError('Server error', -32050, { rule_id: 'QA-007', message: 'bytecode too large' })
    );
    const result = await createBoingAdapter(baseConfig).submitTransaction('0x00');
    expect(result.success).toBe(false);
    expect(result.error).toContain('QA-007');
  });
});

describe('createBoingAdapter.submitTransaction (spec rejection handling)', () => {
  const nodeId = '0x' + 'ef'.repeat(32);
  const hex = '0x00';

  it('returns the node tx_id, not a locally derived one', async () => {
    vi.spyOn(rpc, 'simulateTransaction').mockResolvedValue({ success: true } as never);
    vi.spyOn(rpc, 'submitTransactionDetailed').mockResolvedValue({ txId: nodeId, ack: nodeId });
    const r = await createBoingAdapter(baseConfig).submitTransaction(hex);
    expect(r.success).toBe(true);
    expect(r.txId).toBe(nodeId);
    expect(r.txHash).toBe(nodeId);
  });

  it('treats already_in_mempool as success with the pending id', async () => {
    vi.spyOn(rpc, 'simulateTransaction').mockResolvedValue({ success: true } as never);
    vi.spyOn(rpc, 'submitTransactionDetailed').mockRejectedValue(
      new rpc.RpcClientError('duplicate', -32000, { reason: 'already_in_mempool', tx_hash: nodeId })
    );
    const r = await createBoingAdapter(baseConfig).submitTransaction(hex);
    expect(r.success).toBe(true);
    expect(r.alreadyPending).toBe(true);
    expect(r.txId).toBe(nodeId);
  });

  it.each([
    ['stale_nonce', { expected_nonce: 3, got_nonce: 2 }, /out of date/i],
    ['unknown_sender', {}, /faucet/i],
    ['insufficient_fee', { have: '1000000000000000', need: '2000000000000000' }, /0\.001 BOING.*0\.002 BOING/],
  ])('surfaces %s as a typed, plain-language rejection', async (reason, data, text) => {
    vi.spyOn(rpc, 'simulateTransaction').mockResolvedValue({ success: true } as never);
    vi.spyOn(rpc, 'submitTransactionDetailed').mockRejectedValue(new rpc.RpcClientError('x', -32000, { reason, ...data }));
    const r = await createBoingAdapter(baseConfig).submitTransaction(hex);
    expect(r.success).toBe(false);
    expect(r.reason).toBe(reason);
    expect(r.error).toMatch(text);
  });

  it('never calls operator methods while submitting', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { method: string };
        calls.push(body.method);
        const result =
          body.method === 'boing_health'
            ? { ok: true, chain_id: 6913, tx_signing: { chain_id: 6913, v2_supported: true } }
            : body.method === 'boing_simulateTransaction'
              ? { success: true }
              : { tx_hash: nodeId, tx_id: nodeId };
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
      })
    );
    await createBoingAdapter(baseConfig).submitTransaction(hex);
    expect(calls).toContain('boing_submitTransaction');
    expect(calls.filter((m) => /operator|qa_pool|admin/i.test(m))).toEqual([]);
  });
});