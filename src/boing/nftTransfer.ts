/**
 * Reference NFT transfers. Protocol has single-token `transfer_nft` (0x04) only —
 * multi-send is N sequential ContractCall transactions (honest chunking).
 */

import type { AccountId } from './types';
import { accountIdFromHex, accountIdToHex } from './types';
import { encodeReferenceTransferNftCalldata, normalizeHex64 } from './referenceNft';
import type { NetworkAdapter } from '../networks/types';

export type NftTransferTarget = {
  collectionHex: string;
  tokenIdHex: string;
};

export type NftTransferItemResult = {
  collectionHex: string;
  tokenIdHex: string;
  success: boolean;
  txHash?: string;
  error?: string;
};

export type NftBatchTransferResult = {
  /** Always equal to targets.length — protocol has no multi-token transfer_nft. */
  txCount: number;
  submitted: number;
  failed: number;
  results: NftTransferItemResult[];
};

export function parseTransferRecipientHex(raw: string, ownerHex: string): string {
  const toHex = raw.replace(/\s/g, '').replace(/^0x/i, '');
  if (toHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(toHex)) {
    throw new Error('Invalid address: must be 64 hex characters');
  }
  const owner = normalizeHex64(ownerHex);
  if (toHex.toLowerCase() === owner.toLowerCase()) {
    throw new Error('Cannot transfer to yourself');
  }
  return toHex.toLowerCase();
}

/**
 * Transfer one or more owned reference NFTs.
 * Each item is a separate `transfer_nft` tx (no on-chain batch selector).
 */
export async function transferOwnedNfts(options: {
  network: NetworkAdapter;
  accountId: AccountId;
  privateKey: Uint8Array;
  recipientHex: string;
  targets: NftTransferTarget[];
  /** Optional delay between txs (ms) to let nonce settle. Default 400. */
  delayMs?: number;
  onProgress?: (done: number, total: number, last: NftTransferItemResult) => void;
}): Promise<NftBatchTransferResult> {
  const { network, accountId, privateKey, targets } = options;
  if (!network.buildContractCall) {
    throw new Error('This network adapter cannot send contract calls');
  }
  if (targets.length === 0) {
    throw new Error('Select at least one owned NFT');
  }
  const ownerHex = accountIdToHex(accountId);
  const toHex = parseTransferRecipientHex(options.recipientHex, ownerHex);
  const toId = accountIdFromHex(toHex);
  const delayMs = options.delayMs ?? 400;

  const results: NftTransferItemResult[] = [];
  let nonce = await network.getNonce(accountId);

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    const collectionHex = normalizeHex64(t.collectionHex);
    const tokenIdHex = normalizeHex64(t.tokenIdHex);
    let item: NftTransferItemResult;
    try {
      const collectionId = accountIdFromHex(collectionHex);
      const calldata = encodeReferenceTransferNftCalldata(toId, tokenIdHex);
      const signedHex = await network.buildContractCall(
        accountId,
        collectionId,
        calldata,
        nonce,
        privateKey
      );
      const result = await network.submitTransaction(signedHex);
      if (result.success) {
        item = {
          collectionHex,
          tokenIdHex,
          success: true,
          txHash: result.txHash,
        };
        nonce += 1n;
      } else {
        item = {
          collectionHex,
          tokenIdHex,
          success: false,
          error: result.error ?? 'Submit failed',
        };
        // Refresh nonce after failure — mempool may or may not have consumed it.
        try {
          nonce = await network.getNonce(accountId);
        } catch {
          /* keep */
        }
      }
    } catch (e) {
      item = {
        collectionHex,
        tokenIdHex,
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
      try {
        nonce = await network.getNonce(accountId);
      } catch {
        /* keep */
      }
    }
    results.push(item);
    options.onProgress?.(i + 1, targets.length, item);
    if (i < targets.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return {
    txCount: targets.length,
    submitted: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}
