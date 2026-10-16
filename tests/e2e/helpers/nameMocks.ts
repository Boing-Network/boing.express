import type { BrowserContext } from '@playwright/test';
import { installBoingNetworkMocks, type BoingMockOptions } from './boingRouteMocks';

export const ALICE = 'ab'.repeat(32);

/** Payload variant + leading string field of a signed tx hex (nonce u64, sender 32, then payload). */
export function decode(hex: string): { variant: number; name?: string } {
  const h = hex.replace(/^0x/, '');
  const off = (8 + 32) * 2;
  const le = (s: string) => parseInt(s.match(/../g)!.reverse().join(''), 16);
  const variant = le(h.slice(off, off + 8));
  if (variant >= 14 && variant !== 18) {
    const len = le(h.slice(off + 8, off + 24));
    const name = Buffer.from(h.slice(off + 24, off + 24 + len * 2), 'hex').toString('utf8');
    return { variant, name };
  }
  if (variant === 18 && h.slice(off + 8, off + 10) === '01') {
    const len = le(h.slice(off + 10, off + 26));
    return { variant, name: Buffer.from(h.slice(off + 26, off + 26 + len * 2), 'hex').toString('utf8') };
  }
  return { variant };
}

export const REGISTRY = {
  enabled: true,
  active: true,
  activation_height: 640,
  blocks_per_year: 15_768_000,
  grace_blocks: 1_296_000,
  commit_min_age: 1,
  commit_max_age: 43_200,
};

/** In-memory name registry driven by the submitted txs. */
export function nameMockOptions(submitted: string[], me: { hex: string }): BoingMockOptions {
  const names = new Map<string, { owner: string; target: string }>([['alice', { owner: ALICE, target: ALICE }]]);
  let primary: string | null = null;
  let seen = 0;
  const sync = () => {
    for (; seen < submitted.length; seen++) {
      const d = decode(submitted[seen]!);
      if (d.variant === 14 && d.name) names.set(d.name, { owner: me.hex, target: me.hex });
      if (d.variant === 18) primary = d.name ?? null;
    }
  };
  const rec = (n: string) => {
    const r = names.get(n)!;
    return { name: n, display: `${n}.boing`, owner: `0x${r.owner}`, target: `0x${r.target}`, registered_at: 700, expires_at: 15_768_700, status: 'active' };
  };
  const label = (raw: unknown) => String(raw ?? '').trim().toLowerCase().replace(/\.boing$/, '');
  return {
    submitted,
    simulateGasUsed: 21_000,
    rpc: (method, params) => {
      sync();
      if (method === 'boing_getAccount' && !me.hex) me.hex = String(params[0] ?? '').replace(/^0x/, '').toLowerCase();
      switch (method) {
        case 'boing_getTransactionReceipt':
          return { success: true, block_height: 701 };
        case 'boing_resolveName': {
          const n = label(params[0]);
          return names.has(n) ? rec(n) : null;
        }
        case 'boing_reverseName': {
          const a = String(params[0]).replace(/^0x/, '');
          return primary && a === me.hex ? { name: primary, display: `${primary}.boing`, address: `0x${a}`, verified: true } : null;
        }
        case 'boing_getNameInfo': {
          const n = label(params[0]);
          const reserved = n === 'boing';
          return {
            input: params[0],
            name: n,
            display: `${n}.boing`,
            valid: true,
            reserved,
            available: !reserved && !names.has(n),
            status: names.has(n) ? 'active' : null,
            rent_per_year: n.length >= 6 ? '1' : n.length === 5 ? '2' : n.length === 4 ? '5' : '10',
            ...(names.has(n) ? { record: rec(n) } : {}),
            registry: REGISTRY,
            head_height: 700,
          };
        }
        case 'boing_namesOwnedBy': {
          const a = String(params[0]).replace(/^0x/, '');
          return [...names.keys()].filter((n) => names.get(n)!.owner === a).map(rec);
        }
        default:
          return undefined;
      }
    },
  };
}

export function nameMocks(context: BrowserContext, submitted: string[], me: { hex: string }) {
  return installBoingNetworkMocks(context, nameMockOptions(submitted, me));
}
