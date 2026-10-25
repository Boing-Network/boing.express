import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FeeChooser, LockedTip } from '../src/components/FeeChooser';

const html = (value: { preset: 'slow' | 'normal' | 'fast' | 'custom'; customText: string }, fee: bigint | null = 210_000_000_000_000n) =>
  renderToStaticMarkup(createElement(FeeChooser, { fee, value, onChange: () => {} }));

describe('FeeChooser markup (accessibility)', () => {
  it('is a labelled fieldset with four native radios and a polite status summary', () => {
    const h = html({ preset: 'slow', customText: '' });
    expect(h).toContain('<fieldset');
    expect(h).toContain('<legend');
    expect((h.match(/type="radio"/g) ?? []).length).toBe(4);
    expect(h).toContain('role="radiogroup"');
    expect(h).toContain('aria-live="polite"');
    expect(h).toContain('Slow');
    expect(h).toContain('Custom');
    expect(h).toMatch(/checked=""[^>]*data-testid="fee-chooser-slow"|data-testid="fee-chooser-slow"[^>]*checked=""/);
  });
  it('shows no custom input unless Custom is selected', () => {
    expect(html({ preset: 'fast', customText: '' })).not.toContain('fee-chooser-custom-input');
    expect(html({ preset: 'custom', customText: '0.01' })).toContain('fee-chooser-custom-input');
  });
  it('marks an invalid custom tip with aria-invalid and an alert', () => {
    const h = html({ preset: 'custom', customText: 'oops' });
    expect(h).toContain('aria-invalid="true"');
    expect(h).toContain('role="alert"');
    expect(h).toContain('fee-chooser-custom-error');
    const ok = html({ preset: 'custom', customText: '0.01' });
    expect(ok).not.toContain('aria-invalid');
    expect(ok).not.toContain('role="alert"');
  });
  it('summary states the cost in BOING', () => {
    expect(html({ preset: 'normal', customText: '' })).toMatch(/BOING in all/);
  });
  it('LockedTip states the dApp tip read-only', () => {
    const h = renderToStaticMarkup(createElement(LockedTip, { tip: 10n ** 15n }));
    expect(h).toContain('0.001');
    expect(h).toContain('BOING');
    expect(h).not.toContain('<input');
  });
});