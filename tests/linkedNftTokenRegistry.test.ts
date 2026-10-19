import { describe, expect, it, vi, afterEach } from 'vitest';
import * as rpc from '../src/boing/rpc';
import {
  companionsByCollection,
  listLinkedNftTokenLinks,
  observerCompanionAccountUrl,
  resolveLinkedNftTokenRegistryId,
  DEFAULT_TESTNET_LINKED_NFT_TOKEN_REGISTRY_HEX,
} from '../src/boing/linkedNftTokenRegistry';
import {
  encodeLinkedNftTokenGetLinkAtCalldataHex,
  encodeLinkedNftTokenLinksCountCalldataHex,
} from 'boing-sdk';

const COLLECTION = `0x${'aa'.repeat(32)}`;
const TOKEN = `0x${'bb'.repeat(32)}`;
const ZERO = `0x${'00'.repeat(32)}`;

function u64WordHex(n: number): string {
  const w = new Uint8Array(32);
  new DataView(w.buffer).setBigUint64(24, BigInt(n), false);
  return `0x${[...w].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function linkReturn(collection: string, token: string): string {
  return `${collection}${token.slice(2)}`;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('linkedNftTokenRegistry', () => {
  it('resolves canonical testnet registry when env unset', () => {
    const r = resolveLinkedNftTokenRegistryId({ networkIsTestnet: true });
    expect(r.source).toBe('canonical_testnet');
    expect(r.registryId?.toLowerCase()).toBe(
      DEFAULT_TESTNET_LINKED_NFT_TOKEN_REGISTRY_HEX.toLowerCase()
    );
  });

  it('canonical testnet registry is v2', () => {
    expect(DEFAULT_TESTNET_LINKED_NFT_TOKEN_REGISTRY_HEX).toBe(
      '0xf704485ad29f56bb6516ac822fcf9ca8fcb6c4266e22c9ed7f9c6908668655dd'
    );
  });

  it('prefers env override', () => {
    vi.stubEnv('VITE_BOING_LINKED_NFT_TOKEN_REGISTRY', COLLECTION);
    const r = resolveLinkedNftTokenRegistryId({ networkIsTestnet: true });
    expect(r.source).toBe('env');
    expect(r.registryId).toBe(COLLECTION);
  });

  it('returns null on mainnet without env', () => {
    const r = resolveLinkedNftTokenRegistryId({ networkIsTestnet: false });
    expect(r.registryId).toBeNull();
  });

  it('lists active links and skips tombstones', async () => {
    const countCalldata = encodeLinkedNftTokenLinksCountCalldataHex();
    const at0 = encodeLinkedNftTokenGetLinkAtCalldataHex(0);
    const at1 = encodeLinkedNftTokenGetLinkAtCalldataHex(1);

    vi.spyOn(rpc, 'simulateContractCall').mockImplementation(async (_url, params) => {
      const calldata = String(params[1] ?? '').toLowerCase();
      if (calldata === countCalldata.toLowerCase()) {
        return { success: true, return_data: u64WordHex(2) };
      }
      if (calldata === at0.toLowerCase()) {
        return { success: true, return_data: linkReturn(COLLECTION, TOKEN) };
      }
      if (calldata === at1.toLowerCase()) {
        return { success: true, return_data: linkReturn(ZERO, ZERO) };
      }
      throw new Error(`unexpected calldata ${calldata}`);
    });

    const listed = await listLinkedNftTokenLinks('https://rpc.example', {
      networkIsTestnet: true,
    });
    expect(listed.ok).toBe(true);
    expect(listed.count).toBe(2);
    expect(listed.links).toHaveLength(1);
    expect(listed.links[0].collectionHex).toBe('aa'.repeat(32));
    expect(listed.links[0].tokenHex).toBe('bb'.repeat(32));

    const byColl = companionsByCollection(listed.links);
    expect(byColl.get('aa'.repeat(32))).toEqual(['bb'.repeat(32)]);
  });

  it('builds observer companion account URLs', () => {
    const url = observerCompanionAccountUrl(
      'https://boing.observer/',
      'cc'.repeat(32),
      true
    );
    expect(url).toBe(
      `https://boing.observer/account/${'cc'.repeat(32)}?network=testnet`
    );
  });
});
