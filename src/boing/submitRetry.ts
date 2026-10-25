/**
 * Build, sign and submit with one safe retry on `stale_nonce`.
 *
 * `stale_nonce` means another transaction from this account landed between our nonce read and the
 * submit. The wallet refetches the account nonce (`boing_getAccount`), re-signs the SAME intent once
 * and resubmits. It never loops: a second rejection is shown to the user as-is.
 */

import type { AccountId } from './types';
import type { NetworkAdapter, SubmitResult } from '../networks/types';

export interface SubmitWithRetryOptions {
  /** Use this nonce for the first attempt instead of fetching one (dApp-supplied nonce). */
  nonce?: bigint;
  /** Called once, just before the re-sign, so the UI can say "Refreshing nonce and retrying...". */
  onRetry?: (info: { staleNonce: bigint; freshNonce: bigint }) => void;
}

/**
 * @param build returns the signed tx hex for a given nonce
 * @returns the final `SubmitResult`; `retriedNonce` is true when a re-sign happened.
 */
export async function buildAndSubmit(
  network: Pick<NetworkAdapter, 'getNonce' | 'submitTransaction'>,
  accountId: AccountId,
  build: (nonce: bigint) => Promise<string> | string,
  opts: SubmitWithRetryOptions = {}
): Promise<SubmitResult> {
  const first = opts.nonce ?? (await network.getNonce(accountId));
  const result = await network.submitTransaction(await build(first));
  if (result.success || result.reason !== 'stale_nonce' || opts.nonce != null) return result;

  // The node-reported expected nonce is a hint only; the account state is the source of truth.
  const fresh = await network.getNonce(accountId);
  if (fresh === first) return result; // nothing changed: re-signing would fail the same way
  opts.onRetry?.({ staleNonce: first, freshNonce: fresh });
  const again = await network.submitTransaction(await build(fresh));
  return { ...again, retriedNonce: true };
}