import fs from 'fs';
import path from 'path';

/**
 * Load `.env` then `.env.local` from the repo root into `process.env` so Playwright
 * sees the same `VITE_BOING_*_RPC` values as `vite build` when vars are not exported in the shell.
 * Does not override existing environment variables except keys present in `.env.local`.
 */
export function applyRootDotenv(rootDir: string): void {
  const applyFile = (fileName: string, overrideExisting: boolean): void => {
    const full = path.join(rootDir, fileName);
    if (!fs.existsSync(full)) return;
    const text = fs.readFileSync(full, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (overrideExisting || process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  };

  applyFile('.env', false);
  applyFile('.env.local', true);
}

/**
 * Opt-in headless Chromium for extension E2E.
 * Many Chromium builds do not load MV3 extension service workers when headless; prefer xvfb + headed if tests fail here.
 */
export function extensionE2EHeadless(): boolean {
  return process.env.EXTENSION_E2E_HEADLESS === '1';
}

export function getExtensionChromeArgs(extensionPathArg: string): string[] {
  return [
    `--disable-extensions-except=${extensionPathArg}`,
    `--load-extension=${extensionPathArg}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
}
