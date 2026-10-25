import { describe, expect, it } from 'vitest';
import { describeWalletError } from './errorMessages';
import { RpcClientError } from './rpc';

describe('describeWalletError', () => {
  it('explains node mempool/vm messages in plain language', () => {
    expect(describeWalletError(new RpcClientError('insufficient balance for fee: have 5, need 210000000000000'))).toMatch(/too low to cover the network fee/);
    expect(describeWalletError(new RpcClientError('Invalid nonce: expected 4, got 3'))).toMatch(/still being processed/);
    expect(describeWalletError(new RpcClientError('Duplicate transaction'))).toMatch(/already submitted/);
    expect(describeWalletError(new RpcClientError('Mempool full (4096 pending txs); try again later'))).toMatch(/busy/);
    expect(
      describeWalletError(new RpcClientError('Legacy signature rejected: sign with the chain id (v2 signing domain) after the activation height'))
    ).toMatch(/chain-bound/);
  });

  it('surfaces QA rule_id and message for -32050 and tx_hash for -32051', () => {
    const rejected = new RpcClientError('Server error', -32050, { rule_id: 'QA-007', message: 'bytecode too large' });
    expect(describeWalletError(rejected)).toContain('QA-007');
    expect(describeWalletError(rejected)).toContain('bytecode too large');
    const pooled = new RpcClientError('x', -32051, { tx_hash: '0xabc' });
    expect(describeWalletError(pooled)).toContain('0xabc');
  });

  it('maps JSON-RPC standard codes and pool codes when the node message is generic', () => {
    expect(describeWalletError(new RpcClientError('Invalid parameters', -32602))).toMatch(/address and amount/);
    expect(describeWalletError(new RpcClientError('x', -32700))).toMatch(/could not read the request/);
    expect(describeWalletError(new RpcClientError('x', -32603))).toMatch(/internal error/);
    expect(describeWalletError(new RpcClientError('x', -32055))).toMatch(/pool is full/);
  });

  it('handles network failures and unknown errors', () => {
    expect(describeWalletError(new Error('Failed to fetch'))).toMatch(/Could not reach the network/);
    expect(describeWalletError(new Error('The operation was aborted'))).toMatch(/too long/);
    expect(describeWalletError(new Error('Something custom'))).toBe('Something custom');
    expect(describeWalletError(undefined)).toMatch(/Something went wrong/);
  });
});