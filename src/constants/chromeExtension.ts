/** Where users get Boing Express today.
 * Chrome Web Store item ID is not published in-repo yet (was a literal `[REDACTED]` path).
 * Point install CTAs at the live web wallet until a real CWS URL is committed.
 */
export const CHROME_EXTENSION_STORE_URL = 'https://boing.express';

/** Current extension release (GitHub release asset; same zip that goes to Chrome Web Store review). */
export const EXTENSION_RELEASE_VERSION = '0.1.26';
export const EXTENSION_RELEASE_URL = `https://github.com/Boing-Network/boing.express/releases/tag/extension-v${EXTENSION_RELEASE_VERSION}`;
export const EXTENSION_RELEASE_ZIP_URL = `https://github.com/Boing-Network/boing.express/releases/download/extension-v${EXTENSION_RELEASE_VERSION}/boing-wallet-extension-${EXTENSION_RELEASE_VERSION}.zip`;
