/**
 * Origin-scoped PutBlob publish sessions: one wallet approval covers many
 * subsequent `put_blob` sign/send calls (count + byte caps, TTL).
 *
 * Native `TransactionPayload::Batch` cannot include PutBlob (transfers /
 * contract calls only, ≤16 steps, ≤64 KiB calldata) — sessions are the
 * practical path for NFT collection media on L1.
 */

export const PUT_BLOB_SESSION_FEATURE = 'putBlobSession' as const;

/** Hard ceiling aligned with large-set NFT product rows. */
export const PUT_BLOB_SESSION_MAX_BLOBS_CAP = 10_000;

/** Default session lifetime (2 hours). */
export const PUT_BLOB_SESSION_DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

/** Max session lifetime (24 hours). */
export const PUT_BLOB_SESSION_MAX_TTL_MS = 24 * 60 * 60 * 1000;

/** Default per-blob cap (wallet postMessage / PutBlob practical ceiling). */
export const PUT_BLOB_SESSION_DEFAULT_MAX_BYTES_PER_BLOB = 4 * 1024 * 1024;

/** Default total bytes if dApp omits maxTotalBytes (50 GiB). */
export const PUT_BLOB_SESSION_DEFAULT_MAX_TOTAL_BYTES = 50 * 1024 * 1024 * 1024;

export type PutBlobSessionRequest = {
  maxBlobs: number;
  maxTotalBytes?: number;
  maxBytesPerBlob?: number;
  ttlMs?: number;
};

export type PutBlobSessionState = {
  sessionId: string;
  origin: string;
  address: string;
  chainId: string;
  maxBlobs: number;
  maxTotalBytes: number;
  maxBytesPerBlob: number;
  usedBlobs: number;
  usedBytes: number;
  createdAt: number;
  expiresAt: number;
};

export type PutBlobSessionPublic = {
  sessionId: string;
  maxBlobs: number;
  maxTotalBytes: number;
  maxBytesPerBlob: number;
  usedBlobs: number;
  usedBytes: number;
  remainingBlobs: number;
  remainingBytes: number;
  expiresAt: number;
};

export function normalizePutBlobSessionRequest(raw: unknown): Required<PutBlobSessionRequest> {
  if (raw == null || typeof raw !== 'object') {
    throw new Error('boing_requestPutBlobSession requires one object argument');
  }
  const o = raw as Record<string, unknown>;
  const maxBlobs = Math.trunc(Number(o.maxBlobs ?? o.max_blobs));
  if (!Number.isFinite(maxBlobs) || maxBlobs < 1) {
    throw new Error('maxBlobs must be a positive integer');
  }
  if (maxBlobs > PUT_BLOB_SESSION_MAX_BLOBS_CAP) {
    throw new Error(`maxBlobs exceeds cap (${PUT_BLOB_SESSION_MAX_BLOBS_CAP})`);
  }

  let maxTotalBytes = Number(o.maxTotalBytes ?? o.max_total_bytes);
  if (!Number.isFinite(maxTotalBytes) || maxTotalBytes <= 0) {
    maxTotalBytes = PUT_BLOB_SESSION_DEFAULT_MAX_TOTAL_BYTES;
  }
  maxTotalBytes = Math.trunc(maxTotalBytes);

  let maxBytesPerBlob = Number(o.maxBytesPerBlob ?? o.max_bytes_per_blob);
  if (!Number.isFinite(maxBytesPerBlob) || maxBytesPerBlob <= 0) {
    maxBytesPerBlob = PUT_BLOB_SESSION_DEFAULT_MAX_BYTES_PER_BLOB;
  }
  maxBytesPerBlob = Math.trunc(maxBytesPerBlob);
  if (maxBytesPerBlob > PUT_BLOB_SESSION_DEFAULT_MAX_BYTES_PER_BLOB) {
    // Keep wallet-safe ceiling unless we later raise postMessage limits.
    maxBytesPerBlob = PUT_BLOB_SESSION_DEFAULT_MAX_BYTES_PER_BLOB;
  }

  let ttlMs = Number(o.ttlMs ?? o.ttl_ms);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    ttlMs = PUT_BLOB_SESSION_DEFAULT_TTL_MS;
  }
  ttlMs = Math.min(Math.trunc(ttlMs), PUT_BLOB_SESSION_MAX_TTL_MS);

  return { maxBlobs, maxTotalBytes, maxBytesPerBlob, ttlMs };
}

export function createPutBlobSessionState(input: {
  sessionId: string;
  origin: string;
  address: string;
  chainId: string;
  request: Required<PutBlobSessionRequest>;
  now?: number;
}): PutBlobSessionState {
  const now = input.now ?? Date.now();
  return {
    sessionId: input.sessionId,
    origin: input.origin,
    address: input.address,
    chainId: input.chainId,
    maxBlobs: input.request.maxBlobs,
    maxTotalBytes: input.request.maxTotalBytes,
    maxBytesPerBlob: input.request.maxBytesPerBlob,
    usedBlobs: 0,
    usedBytes: 0,
    createdAt: now,
    expiresAt: now + input.request.ttlMs,
  };
}

export function putBlobSessionToPublic(s: PutBlobSessionState): PutBlobSessionPublic {
  return {
    sessionId: s.sessionId,
    maxBlobs: s.maxBlobs,
    maxTotalBytes: s.maxTotalBytes,
    maxBytesPerBlob: s.maxBytesPerBlob,
    usedBlobs: s.usedBlobs,
    usedBytes: s.usedBytes,
    remainingBlobs: Math.max(0, s.maxBlobs - s.usedBlobs),
    remainingBytes: Math.max(0, s.maxTotalBytes - s.usedBytes),
    expiresAt: s.expiresAt,
  };
}

export function isPutBlobSessionActive(
  s: PutBlobSessionState | null | undefined,
  origin: string,
  address: string,
  now = Date.now()
): s is PutBlobSessionState {
  if (!s) return false;
  if (s.origin !== origin) return false;
  if (s.address.toLowerCase() !== address.toLowerCase()) return false;
  if (now >= s.expiresAt) return false;
  if (s.usedBlobs >= s.maxBlobs) return false;
  if (s.usedBytes >= s.maxTotalBytes) return false;
  return true;
}

/**
 * Hex media length from a dApp `put_blob` request (`data` field).
 * Returns null if not a put_blob or data is missing/invalid.
 */
export function putBlobDataByteLengthFromDappTx(txReq: unknown): number | null {
  if (txReq == null || typeof txReq !== 'object') return null;
  const o = txReq as Record<string, unknown>;
  const type = String(o.type || o.kind || '').toLowerCase();
  if (type !== 'put_blob' && type !== 'putblob') return null;
  const data = o.data;
  if (typeof data !== 'string') return null;
  let hex = data.trim();
  if (hex.startsWith('0x') || hex.startsWith('0X')) hex = hex.slice(2);
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  return hex.length / 2;
}

/**
 * Consume one PutBlob against the session. Throws a short reason string on failure.
 */
export function consumePutBlobSession(
  s: PutBlobSessionState,
  byteLength: number,
  now = Date.now()
): PutBlobSessionState {
  if (now >= s.expiresAt) throw new Error('PutBlob session expired');
  if (byteLength < 1) throw new Error('PutBlob data empty');
  if (byteLength > s.maxBytesPerBlob) {
    throw new Error(`PutBlob exceeds session per-blob cap (${s.maxBytesPerBlob} bytes)`);
  }
  if (s.usedBlobs + 1 > s.maxBlobs) {
    throw new Error('PutBlob session blob count exhausted');
  }
  if (s.usedBytes + byteLength > s.maxTotalBytes) {
    throw new Error('PutBlob session total byte budget exhausted');
  }
  return {
    ...s,
    usedBlobs: s.usedBlobs + 1,
    usedBytes: s.usedBytes + byteLength,
  };
}

export function formatBytesShort(n: number): string {
  const bytes = Number(n) || 0;
  const gb = 1024 * 1024 * 1024;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < gb) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / gb).toFixed(2)} GB`;
}

/** Human rows for the approval popup. */
export function putBlobSessionApprovalRows(req: Required<PutBlobSessionRequest>): { label: string; value: string }[] {
  return [
    { label: 'Type', value: 'PutBlob publish session' },
    { label: 'Max blobs', value: String(req.maxBlobs) },
    { label: 'Max total size', value: formatBytesShort(req.maxTotalBytes) },
    { label: 'Max per blob', value: formatBytesShort(req.maxBytesPerBlob) },
    {
      label: 'Valid for',
      value: `${Math.round(req.ttlMs / 60000)} min (this site only; PutBlob only)`,
    },
  ];
}
