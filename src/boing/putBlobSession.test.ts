import { describe, expect, it } from 'vitest';
import {
  consumePutBlobSession,
  createPutBlobSessionState,
  isPutBlobSessionActive,
  normalizePutBlobSessionRequest,
  putBlobDataByteLengthFromDappTx,
  putBlobSessionToPublic,
} from './putBlobSession';

describe('putBlobSession', () => {
  it('normalizes request with caps', () => {
    const r = normalizePutBlobSessionRequest({ maxBlobs: 100, maxTotalBytes: 1_000_000 });
    expect(r.maxBlobs).toBe(100);
    expect(r.maxTotalBytes).toBe(1_000_000);
    expect(r.maxBytesPerBlob).toBeGreaterThan(0);
    expect(r.ttlMs).toBeGreaterThan(0);
  });

  it('rejects oversized maxBlobs', () => {
    expect(() => normalizePutBlobSessionRequest({ maxBlobs: 50_000 })).toThrow(/cap/);
  });

  it('parses put_blob hex length', () => {
    expect(putBlobDataByteLengthFromDappTx({ type: 'put_blob', data: '0xabcd' })).toBe(2);
    expect(putBlobDataByteLengthFromDappTx({ type: 'transfer', data: '0xabcd' })).toBeNull();
  });

  it('consumes quota and expires', () => {
    const now = 1_000_000;
    let s = createPutBlobSessionState({
      sessionId: 's1',
      origin: 'https://boing.finance',
      address: '0x' + '11'.repeat(32),
      chainId: '0x1b01',
      request: normalizePutBlobSessionRequest({ maxBlobs: 2, maxTotalBytes: 100, maxBytesPerBlob: 50 }),
      now,
    });
    expect(isPutBlobSessionActive(s, 'https://boing.finance', s.address, now)).toBe(true);
    s = consumePutBlobSession(s, 40, now);
    expect(s.usedBlobs).toBe(1);
    expect(s.usedBytes).toBe(40);
    const pub = putBlobSessionToPublic(s);
    expect(pub.remainingBlobs).toBe(1);
    expect(() => consumePutBlobSession(s, 70, now)).toThrow(/per-blob/);
    s = consumePutBlobSession(s, 50, now);
    expect(s.usedBlobs).toBe(2);
    expect(() => consumePutBlobSession(s, 1, now)).toThrow(/count|budget/);
    expect(isPutBlobSessionActive(s, 'https://boing.finance', s.address, s.expiresAt + 1)).toBe(false);
  });
});
