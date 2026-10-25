import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { explorerAccountUrl, explorerBaseFor, explorerTxUrl, resolveExplorerBase } from '../src/boing/explorerLinks';
import { clearNetworkInfoCaches } from '../src/boing/networkInfo';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ViewTxLink } from '../src/components/ViewTxLink';

const id = 'ab'.repeat(32);

describe('explorer deep links', () => {
  it('builds /tx and /account urls with the network query', () => {
    expect(explorerTxUrl('https://boing.observer', id, true)).toBe(`https://boing.observer/tx/0x${id}?network=testnet`);
    expect(explorerTxUrl('https://boing.observer/', `0x${id.toUpperCase()}`, false)).toBe(`https://boing.observer/tx/0x${id}?network=mainnet`);
    expect(explorerAccountUrl('https://boing.observer', `0x${id}`, true)).toBe(`https://boing.observer/account/0x${id}?network=testnet`);
  });
  it('returns null for bad ids or bases (never a broken link)', () => {
    expect(explorerTxUrl('https://boing.observer', 'nope', true)).toBeNull();
    expect(explorerTxUrl('https://boing.observer', id.slice(2), true)).toBeNull();
    expect(explorerAccountUrl(null, id, true)).toBeNull();
    expect(explorerAccountUrl('javascript:alert(1)', id, true)).toBeNull();
  });
  it('prefers the configured base, then the node, else none', () => {
    expect(resolveExplorerBase('https://a.example/', 'https://b.example')).toBe('https://a.example');
    expect(resolveExplorerBase(undefined, 'https://b.example/')).toBe('https://b.example');
    expect(resolveExplorerBase(undefined, null)).toBeNull();
  });
});

describe('explorerBaseFor', () => {
  beforeEach(() => clearNetworkInfoCaches());
  afterEach(() => vi.unstubAllGlobals());
  it('does not call the node when a base is configured', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await explorerBaseFor({ explorerUrl: 'https://boing.observer', rpcUrl: 'https://rpc.test/x' })).toBe('https://boing.observer');
    expect(f).not.toHaveBeenCalled();
  });
  it('falls back to boing_getNetworkInfo end_user.explorer_url', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: { body?: string }) => {
        const rid = JSON.parse(String(init?.body ?? '{}')).id;
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: rid, result: { end_user: { explorer_url: 'https://obs.example/' } } }));
      }),
    );
    expect(await explorerBaseFor({ rpcUrl: 'https://rpc.test/custom' })).toBe('https://obs.example');
  });
});

describe('ViewTxLink', () => {
  it('renders an external link, or nothing without a url', () => {
    const h = renderToStaticMarkup(createElement(ViewTxLink, { url: `https://boing.observer/tx/0x${id}?network=testnet` }));
    expect(h).toContain('View transaction');
    expect(h).toContain('rel="noopener noreferrer"');
    expect(renderToStaticMarkup(createElement(ViewTxLink, { url: null }))).toBe('');
  });
});