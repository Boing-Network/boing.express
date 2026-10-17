import { describe, expect, it } from 'vitest';
import { feeFromGasForDecimals, formatNative, ledgerDecimalsAt, oneBoing } from './nativeUnit';

describe('native BOING denomination', () => {
  it('picks the ledger unit for a height', () => {
    const testnet = { decimals: 18, base_unit_decimals: 18, base_units_from_height: 1050 };
    expect(ledgerDecimalsAt(testnet, 1049)).toBe(0);
    expect(ledgerDecimalsAt(testnet, 1050)).toBe(18);
    expect(ledgerDecimalsAt({ decimals: 18, base_units_from_height: null }, 1)).toBe(18);
    expect(ledgerDecimalsAt({ decimals: 0 }, 5000)).toBe(0);
    expect(ledgerDecimalsAt(null, 1)).toBe(0);
  });

  it('fees: whole-unit rule before, gas x 10^12 base units after', () => {
    expect(feeFromGasForDecimals(21_000n, 0)).toBe(1n);
    expect(feeFromGasForDecimals(21_001n, 0)).toBe(2n);
    expect(feeFromGasForDecimals(21_000n, 18)).toBe(21_000_000_000_000_000n);
    expect(formatNative(feeFromGasForDecimals(21_000n, 18), 18)).toBe('0.021');
    expect(feeFromGasForDecimals(0n, 18)).toBe(0n);
  });

  it('formats ledger amounts', () => {
    expect(formatNative('20', 0)).toBe('20');
    expect(formatNative('20021000000000000000', 18)).toBe('20.021');
    expect(formatNative(oneBoing(18) * 1_000_000n, 18)).toBe('1000000');
    expect(formatNative(1n, 18)).toBe('<0.000001');
    expect(formatNative(1n, 18, 18)).toBe('0.000000000000000001');
  });
});
