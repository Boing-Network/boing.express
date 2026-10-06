import { describe, expect, it, vi } from 'vitest';
import {
  extractHttpOrIpfsUrl,
  metadataHashWordToFetchUrls,
  resolveNftDisplayMetaFromHash,
} from '../src/boing/nftMetadata';

function asciiWordToHex64(text: string): string {
  const bytes = new Uint8Array(32);
  const enc = new TextEncoder().encode(text);
  bytes.set(enc.slice(0, 32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('nftMetadata', () => {
  it('extracts https and ipfs gateway URLs', () => {
    expect(extractHttpOrIpfsUrl('https://cdn.example/a.png')).toBe('https://cdn.example/a.png');
    expect(extractHttpOrIpfsUrl('ipfs://QmHash/path.json')).toBe(
      'https://ipfs.io/ipfs/QmHash/path.json'
    );
  });

  it('builds fetch URLs from an embedded ascii URI in the metadata word', () => {
    const hex = asciiWordToHex64('https://meta.example/1.json');
    const urls = metadataHashWordToFetchUrls(hex);
    expect(urls[0]).toBe('https://meta.example/1.json');
    expect(urls.some((u) => u.includes('ipfs.io/ipfs/'))).toBe(true);
  });

  it('resolves name, description, and image from fetched JSON', async () => {
    const hex = asciiWordToHex64('https://meta.example/1.json');
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        name: 'Goon #1',
        description: 'A test piece',
        image: 'ipfs://bafyImage',
      }),
    })) as unknown as typeof fetch;

    const meta = await resolveNftDisplayMetaFromHash(hex, { fetchImpl });
    expect(meta.name).toBe('Goon #1');
    expect(meta.description).toBe('A test piece');
    expect(meta.imageUrl).toBe('https://ipfs.io/ipfs/bafyImage');
    expect(meta.unresolved).toBe(false);
  });

  it('marks empty / zero hash as unresolved placeholder', async () => {
    const meta = await resolveNftDisplayMetaFromHash('0'.repeat(64));
    expect(meta.unresolved).toBe(true);
    expect(meta.imageUrl).toBeNull();
  });
});
