import { describe, expect, it } from 'vitest';
import {
  MAX_REFERENCE_NFT_MINT_BATCH,
  REF_NFT_OWNER_STORAGE_XOR_HEX,
  encodeReferenceTransferNftCalldata,
  observerNftItemUrl,
  parseReferenceMintBatchTokenIds,
  parseReferenceTransferNftCalldata,
  parseTokenIdInput,
  referenceNftOwnerStorageKey,
  referenceNftTokenIdWordFromU64,
} from '../src/boing/referenceNft';

function hexToBytes(hex64: string): Uint8Array {
  const h = hex64.replace(/^0x/i, '');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

describe('referenceNft', () => {
  it('encodes sequential token ids as low-u64 words', () => {
    expect(referenceNftTokenIdWordFromU64(1)).toBe('0'.repeat(62) + '01');
    expect(parseTokenIdInput('1')).toBe(referenceNftTokenIdWordFromU64(1));
    const word = 'ab'.repeat(32);
    expect(parseTokenIdInput(`0x${word}`)).toBe(word);
  });

  it('builds owner storage keys as token_id XOR mask', () => {
    const tokenId = referenceNftTokenIdWordFromU64(1);
    const key = referenceNftOwnerStorageKey(tokenId);
    const tokenBytes = hexToBytes(tokenId);
    const mask = hexToBytes(REF_NFT_OWNER_STORAGE_XOR_HEX);
    const expected = new Uint8Array(32);
    for (let i = 0; i < 32; i++) expected[i] = tokenBytes[i]! ^ mask[i]!;
    expect(key).toBe(Array.from(expected).map((b) => b.toString(16).padStart(2, '0')).join(''));
  });

  it('parses mint_batch token ids from 96+64n calldata', () => {
    const n = 2;
    const calldata = new Uint8Array(96 + 64 * n);
    calldata[31] = 0x06;
    calldata.fill(0x11, 32, 64);
    calldata[95] = n;
    calldata[96 + 31] = 0x01;
    calldata[96 + 32 + 31] = 0x02;
    const parsed = parseReferenceMintBatchTokenIds(calldata);
    expect(parsed?.n).toBe(2);
    expect(parsed?.toHex).toBe('11'.repeat(32));
    expect(parsed?.tokenIds[0]?.endsWith('01')).toBe(true);
    expect(parsed?.tokenIds[1]?.endsWith('02')).toBe(true);
    expect(MAX_REFERENCE_NFT_MINT_BATCH).toBe(500);
  });

  it('encodes transfer_nft selector 0x04 with to + token id', () => {
    const to = new Uint8Array(32).fill(0xaa);
    const tokenId = referenceNftTokenIdWordFromU64(7);
    const data = encodeReferenceTransferNftCalldata(to, tokenId);
    expect(data.length).toBe(96);
    expect(data[31]).toBe(0x04);
    expect(Array.from(data.slice(32, 64))).toEqual(Array.from(to));
    expect(Array.from(data.slice(64, 96))).toEqual(Array.from(hexToBytes(tokenId)));
    const parsed = parseReferenceTransferNftCalldata(data);
    expect(parsed?.toHex).toBe('aa'.repeat(32));
    expect(parsed?.tokenIdHex).toBe(tokenId);
  });

  it('builds observer item URLs matching /asset/{collection}/item/{tokenId}', () => {
    const collection = 'ab'.repeat(32);
    const tokenId = 'cd'.repeat(32);
    expect(observerNftItemUrl('https://boing.observer', collection, tokenId, true)).toBe(
      `https://boing.observer/asset/${collection}/item/${tokenId}?network=testnet`
    );
  });
});
