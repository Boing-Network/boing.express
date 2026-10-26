/**
 * Recovery-phrase viewing ("Show recovery phrase") for the wallet UI. Same guardrails as revealPrivateKey.ts:
 * the wallet password is required every time, the phrase lives only in memory (see createRevealSession in
 * revealPrivateKey.ts for the auto-hide timer), and nothing here logs or persists it.
 */
import { PhraseAccountError } from '../storage/recoveryVault';
import { RevealError } from './revealPrivateKey';

export type PhraseRevealDeps = {
  /** Decrypt the active account's phrase with the password (throws PhraseAccountError on any failure). */
  readPhrase: (password: string) => Promise<string>;
};

/** Re-verifies the password and returns the active account's recovery phrase (space-separated words). */
export async function revealActiveRecoveryPhrase(password: string, deps: PhraseRevealDeps): Promise<string> {
  if (!password) throw new RevealError('Enter your wallet password.');
  try {
    return await deps.readPhrase(password);
  } catch (e) {
    throw new RevealError(e instanceof PhraseAccountError ? e.message : 'Incorrect password.');
  }
}
