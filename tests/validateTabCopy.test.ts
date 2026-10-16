import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('merged Validate tab', () => {
  it('popup has one Validate tab and no separate Stake/Validator tabs', () => {
    const html = read('extension/popup.html');
    expect(html).toContain('data-testid="wallet-tab-validate"');
    expect(html).not.toContain('id="tab-stake"');
    expect(html).not.toContain('id="tab-validator"');
    // Validator section comes before the secondary bond section.
    expect(html.indexOf('id="validator-root"')).toBeLessThan(html.indexOf('id="staking-section"'));
  });

  it('no copy claims 10,000 BOING is required to validate today', () => {
    for (const f of ['extension/popup.html', 'src/screens/Dashboard.tsx', 'src/components/ValidatorPanel.tsx']) {
      const s = read(f);
      expect(s).not.toMatch(/needs at least 10,000/);
      for (const m of s.matchAll(/10,000/g)) {
        expect(s.slice(Math.max(0, (m.index ?? 0) - 200), (m.index ?? 0) + 100)).toMatch(/future stake-based/);
      }
    }
  });
});
