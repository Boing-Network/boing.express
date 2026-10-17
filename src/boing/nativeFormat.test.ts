import { describe, expect, it } from 'vitest';
import { boingNumber, formatBoing, maxSendableInput, plainTransferFeeLabel } from './nativeUnit';
import { formatBoingAmount } from './chainTxHistory';

describe('shared native formatter', () => {
  it('formats base units and whole BOING', () => {
    expect(formatBoing(168n * 10n ** 18n, 18)).toBe('168 BOING');
    expect(formatBoing('20000000000000000000', 18)).toBe('20 BOING');
    expect(formatBoing(168n, 0)).toBe('168 BOING');
    expect(formatBoing(21_000_000_000_000_000n, 18)).toBe('0.021 BOING');
  });
  it('boingNumber prefers the node *_boing field, else converts', () => {
    expect(boingNumber('20', '20000000000000000000', 18)).toBe('20');
    expect(boingNumber(undefined, '20000000000000000000', 18)).toBe('20');
    expect(boingNumber(null, 10, 0)).toBe('10');
    expect(boingNumber(undefined, undefined, 18)).toBeUndefined();
  });
  it('fee copy and Max', () => {
    expect(plainTransferFeeLabel(18)).toBe('0.021 BOING');
    expect(plainTransferFeeLabel(0)).toBe('1 BOING');
    expect(maxSendableInput(168n * 10n ** 18n, 18)).toBe('167.979');
    expect(maxSendableInput('5', 18)).toBe('0');
    expect(maxSendableInput('100', 0)).toBe('99');
  });
  it('tx history amounts (height-aware decimals) group thousands', () => {
    expect(formatBoingAmount('1234000000000000000000', 18)).toBe('1,234');
    expect(formatBoingAmount('1500000000000000000', 18)).toBe('1.5');
    expect(formatBoingAmount('1234', 0)).toBe('1,234');
  });
});
