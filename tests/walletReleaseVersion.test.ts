import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

/**
 * `__WALLET_VERSION__` feeds the `min_wallet_version` gate. It must be the RELEASE version (the extension manifest,
 * the number `client_hints.min_wallet_version` is expressed in), not package.json's placeholder 0.1.0, or every user
 * would be told to update.
 */
describe('wallet release version source', () => {
  it('manifest.base.json carries a semver release version', () => {
    expect(JSON.parse(read('../extension/manifest.base.json')).version).toMatch(/^\d+\.\d+\.\d+$/);
  });
  for (const cfg of ['../vite.config.ts', '../vite.extension.config.ts']) {
    it(`${cfg.slice(3)} defines __WALLET_VERSION__ from manifest.base.json`, () => {
      const src = read(cfg);
      expect(src).toMatch(/extension\/manifest\.base\.json/);
      expect(src).not.toMatch(/readFileSync\([^)]*'package\.json'/);
    });
  }
});