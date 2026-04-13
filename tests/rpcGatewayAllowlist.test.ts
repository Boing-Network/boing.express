import { describe, expect, it } from 'vitest';
import {
  collectMethodsFromPayload,
  DEFAULT_GATEWAY_METHOD_ALLOWLIST,
  denyReasonForPayload,
  parseAllowlist,
} from '../workers/rpc-gateway/src/allowlist';

describe('rpc gateway allowlist', () => {
  it('parses comma-separated override', () => {
    const s = parseAllowlist(' boing_health , boing_chainHeight ');
    expect(s.has('boing_health')).toBe(true);
    expect(s.has('boing_chainHeight')).toBe(true);
    expect(s.has('boing_submitTransaction')).toBe(false);
  });

  it('defaults to read-oriented allowlist including DEX discovery', () => {
    const s = parseAllowlist(undefined);
    for (const m of DEFAULT_GATEWAY_METHOD_ALLOWLIST) {
      expect(s.has(m)).toBe(true);
    }
    expect(s.has('boing_submitTransaction')).toBe(false);
  });

  it('collects methods from single and batch JSON-RPC', () => {
    expect(collectMethodsFromPayload({ jsonrpc: '2.0', id: 1, method: 'boing_health', params: [] })).toEqual([
      'boing_health',
    ]);
    expect(
      collectMethodsFromPayload([
        { jsonrpc: '2.0', id: 1, method: 'boing_listDexPools', params: [{}] },
        { jsonrpc: '2.0', id: 2, method: 'boing_listDexTokens', params: [{}] },
      ])
    ).toEqual(['boing_listDexPools', 'boing_listDexTokens']);
  });

  it('denies empty or unknown methods', () => {
    const allowed = parseAllowlist(undefined);
    expect(denyReasonForPayload({}, allowed)).toBe('invalid_jsonrpc_body');
    expect(denyReasonForPayload({ jsonrpc: '2.0', method: 'boing_submitTransaction', params: [] }, allowed)).toBe(
      'method_not_allowed:boing_submitTransaction'
    );
    expect(denyReasonForPayload({ jsonrpc: '2.0', method: 'boing_health', params: [] }, allowed)).toBe(null);
  });
});
