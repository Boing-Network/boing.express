/**
 * Name chosen during wallet creation, claimed on-chain once the account has enough BOING
 * (commit → register → primary). Bound to the first account that opens the dashboard after creation.
 */
const KEY = 'boing-express-pending-name';

export interface PendingNameClaim {
  name: string;
  /** 64-hex address (lowercase, no 0x) once bound. */
  address?: string;
  networkId?: string;
  createdAt: number;
  lastError?: string;
}

export function getPendingName(): PendingNameClaim | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingNameClaim) : null;
  } catch {
    return null;
  }
}

export function setPendingName(p: PendingNameClaim | null): void {
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}