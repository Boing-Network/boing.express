/**
 * Message-signing helpers shared by the extension and the web signing flow.
 *
 * Boing message signatures are Ed25519(BLAKE3(message)) and transaction signatures are
 * Ed25519(BLAKE3(nonce_LE(8) || sender(32) || payload || access_list)). Without a guard, a dApp could
 * pass a transaction preimage as a "message" and get a valid transaction signature. We refuse any
 * message whose bytes 8..40 equal the signer's account id (the transaction preimage layout).
 */

export const TX_PREIMAGE_MESSAGE_REFUSED =
  'Refusing to sign: this "message" has the layout of a Boing transaction for your account. Signing it could authorize a transaction.';

/** UTF-8 text, or 0x-prefixed hex bytes (same rules as boing_signMessage in the extension). */
export function messageToBytes(message: unknown): Uint8Array {
  if (typeof message !== 'string') throw new Error('boing_signMessage requires a UTF-8 string or 0x-prefixed hex string.');
  const t = message.trim();
  if (t.startsWith('0x') && /^0x[0-9a-fA-F]+$/.test(t) && t.length > 2) {
    if (t.length % 2 !== 0) throw new Error('Invalid hex length.');
    const out = new Uint8Array((t.length - 2) / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(t.slice(2 + i * 2, 4 + i * 2), 16);
    return out;
  }
  return new TextEncoder().encode(message);
}

export function looksLikeTransactionPreimage(message: Uint8Array, sender: Uint8Array): boolean {
  if (message.length < 40 || sender.length !== 32) return false;
  for (let i = 0; i < 32; i++) if (message[8 + i] !== sender[i]) return false;
  return true;
}
