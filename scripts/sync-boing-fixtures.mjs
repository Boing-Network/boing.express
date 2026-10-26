#!/usr/bin/env node
/**
 * Vendored boing.network fixtures: copy (or verify) the machine-readable files the wallet tests consume.
 *
 *   node scripts/sync-boing-fixtures.mjs           copy from ../boing.network (or $BOING_NETWORK_DIR) into tests/fixtures
 *   node scripts/sync-boing-fixtures.mjs --check   exit 1 if the vendored copies differ from the sibling checkout
 *
 * boing.network is the source of truth. Never edit the copies by hand: re-run this script after the network repo changes
 * (the vendored copy is what CI uses, so CI needs no sibling checkout). Line endings are ignored when comparing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const network = resolve(process.env.BOING_NETWORK_DIR || join(root, '..', 'boing.network'));
const FILES = [
  ['docs/fixtures/tx-signing-golden-vectors.json', 'tests/fixtures/tx-signing-golden-vectors.json'],
  ['docs/chain-metadata.json', 'tests/fixtures/chain-metadata.json'],
];
const check = process.argv.includes('--check');
const norm = (s) => s.replace(/\r\n/g, '\n');
/** True when the upstream file has uncommitted edits (so the copy would vendor unreleased content). */
function upstreamDirty(rel) {
  try {
    return execFileSync('git', ['-C', network, 'status', '--porcelain', '--', rel], { encoding: 'utf8' }).trim() !== '';
  } catch {
    return false;
  }
}

if (!existsSync(network)) {
  console.error(`boing.network checkout not found at ${network} (set BOING_NETWORK_DIR).`);
  process.exit(check ? 0 : 1); // --check is a no-op where the sibling repo does not exist (CI uses the vendored copy)
}

let drift = 0;
for (const [from, to] of FILES) {
  const src = join(network, from);
  const dst = join(root, to);
  if (!existsSync(src)) {
    console.error(`missing upstream file: ${from}`);
    drift++;
    continue;
  }
  if (upstreamDirty(from)) console.warn(`warning: boing.network/${from} has uncommitted changes; the comparison/copy includes unreleased content.`);
  const want = norm(readFileSync(src, 'utf8'));
  const have = existsSync(dst) ? norm(readFileSync(dst, 'utf8')) : null;
  if (check) {
    if (have !== want) {
      console.error(`DRIFT: ${to} differs from boing.network/${from}. Run: node scripts/sync-boing-fixtures.mjs`);
      drift++;
    } else console.log(`ok: ${to}`);
  } else {
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, want);
    console.log(`${have === want ? 'unchanged' : 'updated'}: ${to}`);
  }
}
process.exit(drift ? 1 : 0);