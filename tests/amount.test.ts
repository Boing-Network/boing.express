import { describe, expect, it } from 'vitest';
import { parseDecimalAmount } from '../src/boing/amount';

describe('parseDecimalAmount', () => {
  it('parses whole BOING amounts when decimals are 0', () => {
    expect(parseDecimalAmount('100', 0)).toBe(100n);
    expect(parseDecimalAmount('1', 0)).toBe(1n);
    expect(parseDecimalAmount('0', 0)).toBe(0n);
    expect(parseDecimalAmount('1000', 0)).toBe(1000n);
    expect(parseDecimalAmount('  42  ', 0)).toBe(42n);
  });

  it('allows only zero fractional part when decimals are 0', () => {
    expect(parseDecimalAmount('100.0', 0)).toBe(100n);
    expect(parseDecimalAmount('100.000', 0)).toBe(100n);
    expect(parseDecimalAmount('5.', 0)).toBe(5n);
  });

  it('rejects non-zero fraction when decimals are 0', () => {
    expect(parseDecimalAmount('1.5', 0)).toBeNull();
    expect(parseDecimalAmount('0.1', 0)).toBeNull();
  });

  it('still parses ERC-style decimals', () => {
    expect(parseDecimalAmount('1', 18)).toBe(10n ** 18n);
    expect(parseDecimalAmount('1.5', 18)).toBe(15n * 10n ** 17n);
  });
});
