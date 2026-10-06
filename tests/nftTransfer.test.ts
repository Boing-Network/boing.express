import { describe, expect, it, vi } from 'vitest';
import { parseTransferRecipientHex, transferOwnedNfts } from '../src/boing/nftTransfer';
import type { NetworkAdapter } from '../src/networks/types';
import { accountIdFromHex } from '../src/boing/types';

describe('nftTransfer', () => {
  it('rejects invalid or self recipient', () => {
    const owner = 'aa'.repeat(32);
    expect(() => parseTransferRecipientHex('zz', owner)).toThrow(/64 hex/);
    expect(() => parseTransferRecipientHex(owner, owner)).toThrow(/yourself/);
    expect(parseTransferRecipientHex('bb'.repeat(32), owner)).toBe('bb'.repeat(32));
  });

  it('sends one transfer_nft tx per selected item', async () => {
    const accountId = accountIdFromHex('aa'.repeat(32));
    const privateKey = new Uint8Array(32);
    const buildContractCall = vi.fn(async () => 'signed');
    const submitTransaction = vi
      .fn()
      .mockResolvedValueOnce({ success: true, txHash: 'h1' })
      .mockResolvedValueOnce({ success: true, txHash: 'h2' });
    const network = {
      config: { id: 'testnet', name: 't', rpcUrl: 'http://x', isTestnet: true },
      getBalance: async () => 0n,
      getNonce: async () => 7n,
      submitTransaction,
      buildContractCall,
    } as unknown as NetworkAdapter;

    const result = await transferOwnedNfts({
      network,
      accountId,
      privateKey,
      recipientHex: 'bb'.repeat(32),
      delayMs: 0,
      targets: [
        { collectionHex: 'cc'.repeat(32), tokenIdHex: '01'.repeat(32) },
        { collectionHex: 'cc'.repeat(32), tokenIdHex: '02'.repeat(32) },
      ],
    });

    expect(result.txCount).toBe(2);
    expect(result.submitted).toBe(2);
    expect(result.failed).toBe(0);
    expect(buildContractCall).toHaveBeenCalledTimes(2);
    expect(submitTransaction).toHaveBeenCalledTimes(2);
    // Nonces 7 then 8
    expect(buildContractCall.mock.calls[0]![3]).toBe(7n);
    expect(buildContractCall.mock.calls[1]![3]).toBe(8n);
  });
});
