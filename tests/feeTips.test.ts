import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIP_CHOICE,
  MAX_CUSTOM_TIP,
  describeTipCost,
  parseCustomTip,
  resolveTip,
  tipPresets,
} from '../src/boing/feeTips';

const BOING = 10n ** 18n;

describe('tipPresets', () => {
  it('offers slow < normal < fast, with slow = no tip', () => {
    const [slow, normal, fast] = tipPresets();
    expect(slow.id).toBe('slow');
    expect(slow.tip).toBe(0n);
    expect(normal.tip).toBeGreaterThan(0n);
    expect(fast.tip).toBeGreaterThan(normal.tip);
    expect(fast.tip).toBeLessThan(MAX_CUSTOM_TIP);
  });
  it('defaults to slow so behaviour matches wallets without tips', () => {
    expect(resolveTip(DEFAULT_TIP_CHOICE)).toEqual({ tip: 0n });
  });
});

describe('parseCustomTip', () => {
  it('parses decimal BOING into base units', () => {
    expect(parseCustomTip('0.001')).toEqual({ ok: true, tip: 10n ** 15n });
    expect(parseCustomTip(' 1 ')).toEqual({ ok: true, tip: BOING });
    expect(parseCustomTip('.5')).toEqual({ ok: true, tip: BOING / 2n });
    expect(parseCustomTip('0.000000000000000001')).toEqual({ ok: true, tip: 1n });
  });
  it('rejects empty, malformed, too precise and over-cap input', () => {
    expect(parseCustomTip('').ok).toBe(false);
    expect(parseCustomTip('.').ok).toBe(false);
    expect(parseCustomTip('abc').ok).toBe(false);
    expect(parseCustomTip('1e3').ok).toBe(false);
    expect(parseCustomTip('-1').ok).toBe(false);
    expect(parseCustomTip('0.0000000000000000001').ok).toBe(false);
    expect(parseCustomTip('1.000000000000000001').ok).toBe(false);
    expect(parseCustomTip('100').ok).toBe(false);
  });
});

describe('resolveTip', () => {
  it('resolves presets and custom amounts, flagging invalid custom input', () => {
    expect(resolveTip({ preset: 'fast', customText: '' }).tip).toBe(tipPresets()[2].tip);
    expect(resolveTip({ preset: 'custom', customText: '0.01' })).toEqual({ tip: 10n ** 16n });
    const bad = resolveTip({ preset: 'custom', customText: 'x' });
    expect(bad.tip).toBe(0n);
    expect(bad.error).toBeTruthy();
  });
});

describe('describeTipCost', () => {
  it('is plain BOING language with no fiat', () => {
    const s = describeTipCost(210_000_000_000_000n, 2_100_000_000_000_000n);
    expect(s).toContain('BOING');
    expect(s).toContain('0.00021');
    expect(s).toContain('0.0021');
    expect(s).toContain('0.00231');
    expect(s).not.toMatch(/\$|USD|EUR/);
  });
  it('handles no tip and an unknown fee', () => {
    expect(describeTipCost(null, 0n)).toMatch(/estimated/);
    expect(describeTipCost(BOING, 0n)).toMatch(/No tip/);
    expect(describeTipCost(null, 5n)).toMatch(/tip/);
  });
});