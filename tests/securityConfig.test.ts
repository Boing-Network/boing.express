import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('security configuration', () => {
  it('extension pages have an explicit, tight CSP and minimal permissions', () => {
    const m = JSON.parse(read('extension/manifest.base.json'));
    const csp: string = m.content_security_policy?.extension_pages ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/unsafe-eval|unsafe-inline/);
    expect(m.permissions).toEqual(['storage']);
  });

  it('web app headers forbid framing and inline script', () => {
    const h = read('public/_headers');
    expect(h).toContain("frame-ancestors 'none'");
    expect(h).toMatch(/script-src 'self';/);
    expect(h).not.toMatch(/script-src[^;]*unsafe/);
    expect(h).toContain('X-Content-Type-Options: nosniff');
  });
});