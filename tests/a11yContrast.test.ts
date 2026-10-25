import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** WCAG 2.x relative luminance / contrast ratio for #rrggbb colours. */
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
export function contrast(a: string, b: string): number {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** First `--name: #hex` declaration in a stylesheet. */
function token(css: string, name: string): string {
  const m = css.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\b`));
  if (!m) throw new Error(`token ${name} not found as a 6-digit hex`);
  return m[1]!;
}

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const AA = 4.5;

describe('contrast of the small-text colours (WCAG AA 4.5:1)', () => {
  it('computes known ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#64748b', '#0d1f3c')).toBeLessThan(AA);
  });

  it('web app: muted / secondary text and danger text on every dark surface', () => {
    const css = read('src/index.css');
    const surfaces = ['--boing-black', '--boing-navy', '--boing-navy-mid'].map((n) => token(css, n));
    for (const fg of ['--text-muted', '--text-secondary', '--text-primary', '--danger']) {
      const color = token(css, fg);
      for (const bg of surfaces) expect(contrast(color, bg), `${fg} ${color} on ${bg}`).toBeGreaterThanOrEqual(AA);
    }
    expect(contrast(token(css, '--trust-green'), surfaces[2]!)).toBeGreaterThanOrEqual(AA);
  });

  it('extension popup: muted / secondary / danger / success on bg and elevated surface', () => {
    const css = read('extension/popup.css');
    const surfaces = ['--bg', '--surface-elevated'].map((n) => token(css, n));
    for (const fg of ['--muted', '--text-secondary', '--text', '--danger', '--success']) {
      const color = token(css, fg);
      for (const bg of surfaces) expect(contrast(color, bg), `${fg} ${color} on ${bg}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it('approval page: secondary text and danger on bg and strong surface', () => {
    const css = read('extension/approval.css');
    const surfaces = ['--bg', '--surface', '--surface-strong'].map((n) => token(css, n));
    for (const fg of ['--text', '--text-secondary', '--danger']) {
      const color = token(css, fg);
      for (const bg of surfaces) expect(contrast(color, bg), `${fg} ${color} on ${bg}`).toBeGreaterThanOrEqual(AA);
    }
  });
});