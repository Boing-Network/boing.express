/**
 * Parse human-readable token amount (e.g. "1.5") to smallest-unit bigint.
 * Avoids float precision issues; native BOING uses whole units (decimals 0).
 */

/**
 * Parse a decimal amount string to bigint in smallest units.
 * @param str - e.g. "1", "1.5", "0.001"
 * @param decimals - token decimals (0 for native BOING)
 * @returns bigint in smallest units, or null if invalid
 */
export function parseDecimalAmount(str: string, decimals: number): bigint | null {
  const trimmed = str.replace(/\s/g, '').replace(/,/g, '');
  if (trimmed === '') return null;
  if (decimals < 0 || decimals > 78) return null;

  const parts = trimmed.split('.');
  if (parts.length > 2) return null;

  // Native BOING uses whole units (decimals 0). Empty fractional slice made fracPart "",
  // and /^\d+$/ did not match "", so integers like "100" incorrectly returned null.
  if (decimals === 0) {
    if (parts.length > 1 && !/^0*$/.test((parts[1] ?? '').replace(/\s/g, ''))) {
      return null;
    }
    const intPart = (parts[0] ?? '').replace(/^0+/, '') || '0';
    if (!/^\d+$/.test(intPart)) return null;
    return BigInt(intPart);
  }

  const intPart = (parts[0] ?? '').replace(/^0+/, '') || '0';
  const fracPart = (parts[1] ?? '').slice(0, decimals).padEnd(decimals, '0');

  if (!/^\d+$/.test(intPart) || !/^\d+$/.test(fracPart)) return null;
  if (fracPart.length !== decimals) return null;

  const one = 10n ** BigInt(decimals);
  const whole = BigInt(intPart) * one;
  const frac = BigInt(fracPart);
  return whole + frac;
}

/**
 * Format smallest-unit balance to human-readable string.
 * @param valueRaw - balance as decimal string (smallest units)
 * @param decimals - token decimals
 * @param maxFractionDigits - max digits after decimal
 */
export function formatBalance(
  valueRaw: string,
  decimals: number,
  maxFractionDigits: number = 6
): string {
  const value = BigInt(valueRaw);
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const frac = value % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, maxFractionDigits).replace(/0+$/, '');
  if (fracStr === '') return whole.toString();
  return `${whole}.${fracStr}`;
}
