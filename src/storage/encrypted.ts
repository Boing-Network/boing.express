/**
 * Encrypt/decrypt private key with user password. Uses Web Crypto AES-GCM.
 * Store ciphertext in localStorage/IndexedDB; never store plaintext keys.
 */

const ALG = 'AES-GCM';
const KEY_LEN = 256;
const IV_LEN = 12;
const SALT_LEN = 16;
const ITERATIONS = 310000;

function getPasswordKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  ).then((keyMaterial) =>
    crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: ALG, length: KEY_LEN },
      false,
      ['encrypt', 'decrypt']
    )
  );
}

/** Encrypt private key (32 bytes) with password. Returns hex string: salt(32 hex) + iv(24 hex) + ciphertext. */
export async function encryptPrivateKey(privateKey: Uint8Array, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await getPasswordKey(password, salt);
  const cipher = await crypto.subtle.encrypt(
    { name: ALG, iv, tagLength: 128 },
    key,
    privateKey
  );
  const combined = new Uint8Array(salt.length + iv.length + cipher.byteLength);
  combined.set(salt, 0);
  combined.set(iv, SALT_LEN);
  combined.set(new Uint8Array(cipher), SALT_LEN + IV_LEN);
  return Array.from(combined)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Decrypt private key from hex blob produced by encryptPrivateKey. */
export async function decryptPrivateKey(hexBlob: string, password: string): Promise<Uint8Array> {
  if (hexBlob.length < (SALT_LEN + IV_LEN) * 2 || hexBlob.length % 2 !== 0)
    throw new Error('Invalid encrypted blob');
  const raw = new Uint8Array(hexBlob.length / 2);
  for (let i = 0; i < raw.length; i++) raw[i] = parseInt(hexBlob.slice(i * 2, i * 2 + 2), 16);
  const salt = raw.slice(0, SALT_LEN);
  const iv = raw.slice(SALT_LEN, SALT_LEN + IV_LEN);
  const ciphertext = raw.slice(SALT_LEN + IV_LEN);
  const key = await getPasswordKey(password, salt);
  const dec = await crypto.subtle.decrypt(
    { name: ALG, iv, tagLength: 128 },
    key,
    ciphertext
  );
  const out = new Uint8Array(dec);
  if (out.length !== 32) throw new Error('Decrypted key must be 32 bytes');
  return out;
}
