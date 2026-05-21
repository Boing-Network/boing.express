import { describe, expect, it } from 'vitest';
import { formatBalance, parseDecimalAmount, parseU128String } from '../src/boing/amount';

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

describe('parseU128String / formatBalance', () => {
  it('parses integer decimal strings only', () => {
    expect(parseU128String('100')).toBe(100n);
    expect(parseU128String(' 1000 ')).toBe(1000n);
    expect(parseU128String('100.0')).toBeNull();
    expect(parseU128String('')).toBeNull();
  });

  it('formatBalance returns em dash for invalid RPC values instead of throwing', () => {
    expect(formatBalance('100', 0)).toBe('100');
    expect(formatBalance('not-a-number', 0)).toBe('—');
  });
});
