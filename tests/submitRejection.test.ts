import { describe, expect, it, vi } from 'vitest';
import {
  describeRejection,
  rejectionFromError,
  rejectionFromMessage,
  rejectionFromRpcData,
} from '../src/boing/submitRejection';
import { RpcClientError, parseSubmitResponse } from '../src/boing/rpc';
import { describeWalletError } from '../src/boing/errorMessages';
import { buildAndSubmit } from '../src/boing/submitRetry';
import type { SubmitResult } from '../src/networks/types';

const rpcErr = (reason: string, extra: Record<string, unknown> = {}) =>
  new RpcClientError('rejected', -32000, { reason, ...extra });

describe('error.data.reason parsing (RPC-API-SPEC rejection shapes)', () => {
  it('parses stale_nonce', () => {
    const r = rejectionFromError(rpcErr('stale_nonce', { expected_nonce: 7, got_nonce: 5 }))!;
    expect(r.reason).toBe('stale_nonce');
    expect(r.expectedNonce).toBe(7n);
    expect(r.gotNonce).toBe(5n);
  });

  it('parses insufficient_fee with decimal-string base units', () => {
    const r = rejectionFromError(rpcErr('insufficient_fee', { have: '100000000000000', need: '210000000000000' }))!;
    expect(r.have).toBe(100000000000000n);
    expect(r.need).toBe(210000000000000n);
    const text = describeRejection(r);
    expect(text).toContain('0.0001 BOING');
    expect(text).toContain('0.00021 BOING');
    expect(text).toContain('0.00011 BOING short');
  });

  it('unknown_sender gives a fund-this-account message, with a faucet hint on testnet', () => {
    const r = rejectionFromError(rpcErr('unknown_sender'))!;
    expect(describeRejection(r)).toMatch(/Fund it first|Receive some BOING/i);
    expect(describeRejection(r, { testnet: true })).toMatch(/faucet/i);
    expect(describeRejection(r, { testnet: false })).not.toMatch(/faucet/i);
  });

  it('parses already_in_mempool with the pending tx hash', () => {
    const h = '0x' + 'ab'.repeat(32);
    const r = rejectionFromError(rpcErr('already_in_mempool', { tx_hash: h }))!;
    expect(r.reason).toBe('already_in_mempool');
    expect(r.txHash).toBe(h);
  });

  it('parses the other documented reasons and degrades unknown ones to "other"', () => {
    expect(rejectionFromError(rpcErr('free_pending_limit', { limit: 4 }))!.limit).toBe(4);
    expect(rejectionFromError(rpcErr('free_tx_balance_gate', { have: '1', need: '9' }))!.need).toBe(9n);
    expect(rejectionFromError(rpcErr('native_value_not_active', { active_from: 1150 }))!.activeFrom).toBe(1150);
    expect(rejectionFromError(rpcErr('pool_full'))!.reason).toBe('pool_full');
    expect(rejectionFromError(rpcErr('some_future_reason'))!.reason).toBe('other');
  });

  it('data.reason wins over contradictory message text', () => {
    const e = new RpcClientError('insufficient balance for fee: have 1, need 2', -32000, { reason: 'unknown_sender' });
    expect(rejectionFromError(e)!.reason).toBe('unknown_sender');
  });

  it('falls back to message patterns for nodes without data.reason', () => {
    expect(rejectionFromMessage('invalid nonce: expected 7, got 5')!.reason).toBe('stale_nonce');
    // A future nonce is admitted by the node, so it is not a rejection.
    expect(rejectionFromMessage('invalid nonce: expected 5, got 7')).toBeNull();
    expect(rejectionFromMessage('insufficient balance for fee: have 3, need 8')!.need).toBe(8n);
    expect(rejectionFromMessage('duplicate transaction')!.reason).toBe('already_in_mempool');
    expect(rejectionFromError(new Error('Something else'))).toBeNull();
    expect(rejectionFromRpcData(new Error('invalid nonce: expected 7, got 5'))).toBeNull();
  });

  it('describeWalletError routes node reasons to plain language', () => {
    expect(describeWalletError(rpcErr('stale_nonce', { expected_nonce: 2, got_nonce: 1 }))).toMatch(/out of date/i);
    expect(describeWalletError(rpcErr('unknown_sender'))).toMatch(/doesn't hold any BOING/i);
  });
});

describe('submit response ids', () => {
  const id = '0x' + 'cd'.repeat(32);
  it('uses the real tx_id / tx_hash from the node', () => {
    expect(parseSubmitResponse({ tx_hash: id, tx_id: id }).txId).toBe(id);
    expect(parseSubmitResponse({ tx_hash: id }).txId).toBe(id);
    expect(parseSubmitResponse({ tx_hash: 'ok', tx_id: id.toUpperCase().replace('0X', '0x') }).txId).toBe(id);
  });
  it('tolerates the legacy {tx_hash:"ok"} answer', () => {
    const r = parseSubmitResponse({ tx_hash: 'ok' });
    expect(r.txId).toBeUndefined();
    expect(r.ack).toBe('ok');
  });
});

describe('buildAndSubmit (one stale_nonce retry)', () => {
  const acct = new Uint8Array(32) as never;
  const stale: SubmitResult = { success: false, reason: 'stale_nonce', error: 'stale' };
  const ok: SubmitResult = { success: true, txHash: '0x01', txId: '0x01' };

  it('refetches the nonce, re-signs once and succeeds', async () => {
    const getNonce = vi.fn().mockResolvedValueOnce(5n).mockResolvedValueOnce(6n);
    const submitTransaction = vi.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(ok);
    const build = vi.fn(async (n: bigint) => `0xsigned${n}`);
    const onRetry = vi.fn();
    const r = await buildAndSubmit({ getNonce, submitTransaction }, acct, build, { onRetry });
    expect(r.success).toBe(true);
    expect(r.retriedNonce).toBe(true);
    expect(build.mock.calls.map((c) => c[0])).toEqual([5n, 6n]);
    expect(submitTransaction.mock.calls.map((c) => c[0])).toEqual(['0xsigned5', '0xsigned6']);
    expect(onRetry).toHaveBeenCalledWith({ staleNonce: 5n, freshNonce: 6n });
  });

  it('retries only once', async () => {
    const getNonce = vi.fn().mockResolvedValueOnce(5n).mockResolvedValueOnce(6n).mockResolvedValue(7n);
    const submitTransaction = vi.fn().mockResolvedValue(stale);
    const r = await buildAndSubmit({ getNonce, submitTransaction }, acct, async (n) => `0x${n}`);
    expect(submitTransaction).toHaveBeenCalledTimes(2);
    expect(r.success).toBe(false);
    expect(r.reason).toBe('stale_nonce');
  });

  it('does not re-sign when the nonce did not move, or when the dApp fixed the nonce', async () => {
    const same = { getNonce: vi.fn().mockResolvedValue(5n), submitTransaction: vi.fn().mockResolvedValue(stale) };
    await buildAndSubmit(same, acct, async (n) => `0x${n}`);
    expect(same.submitTransaction).toHaveBeenCalledTimes(1);
    const explicit = { getNonce: vi.fn(), submitTransaction: vi.fn().mockResolvedValue(stale) };
    await buildAndSubmit(explicit, acct, async (n) => `0x${n}`, { nonce: 9n });
    expect(explicit.getNonce).not.toHaveBeenCalled();
    expect(explicit.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not retry other rejections', async () => {
    const getNonce = vi.fn().mockResolvedValue(5n);
    const submitTransaction = vi.fn().mockResolvedValue({ success: false, reason: 'unknown_sender', error: 'x' });
    const r = await buildAndSubmit({ getNonce, submitTransaction }, acct, async (n) => `0x${n}`);
    expect(submitTransaction).toHaveBeenCalledTimes(1);
    expect(r.reason).toBe('unknown_sender');
  });
});