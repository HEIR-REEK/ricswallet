import { formatUnits, parseUnits } from 'ethers';
import { USDT_DECIMALS } from './constants.js';

/**
 * Parse a human-readable token string (e.g. "25", "3.50", "0.123456789012345678")
 * into exact raw base-unit integer string (uint256 string) using BigInt only.
 * Never uses floating-point numbers.
 */
export function parseTokenAmountToRaw(amountInput: string, decimals: number = USDT_DECIMALS): string {
  const trimmed = amountInput.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid token amount "${amountInput}". Provide a non-negative decimal string.`);
  }
  const [, frac = ''] = trimmed.split('.');
  if (frac.length > decimals) {
    throw new Error(`Amount "${amountInput}" exceeds maximum precision of ${decimals} decimals.`);
  }
  const raw = parseUnits(trimmed, decimals);
  if (raw < 0n) {
    throw new Error('Token amount cannot be negative.');
  }
  return raw.toString();
}

/**
 * Format an exact raw integer string (uint256) into a human-readable decimal string
 * without floating-point arithmetic.
 * Always shows at least `minFractionDigits` (default 2) and trims trailing zeros beyond that.
 */
export function formatRawTokenAmount(
  rawAmount: string | bigint | null | undefined,
  decimals: number = USDT_DECIMALS,
  minFractionDigits: number = 2,
  maxFractionDigits: number = 6
): string {
  if (rawAmount === null || rawAmount === undefined || rawAmount === '') {
    return '0.' + '0'.repeat(minFractionDigits);
  }
  const value = typeof rawAmount === 'bigint' ? rawAmount : BigInt(rawAmount);
  const negative = value < 0n;
  const absVal = negative ? -value : value;
  const full = formatUnits(absVal, decimals); // e.g. "25.0" or "3.125"
  const [whole, frac = ''] = full.split('.');

  // Add thousands separators to whole part using string slicing only
  const formattedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  let trimmedFrac = frac.replace(/0+$/, '');
  if (trimmedFrac.length > maxFractionDigits) {
    trimmedFrac = trimmedFrac.slice(0, maxFractionDigits).replace(/0+$/, '');
  }
  if (trimmedFrac.length < minFractionDigits) {
    trimmedFrac = trimmedFrac.padEnd(minFractionDigits, '0');
  }

  const sign = negative ? '-' : '';
  return trimmedFrac.length > 0 ? `${sign}${formattedWhole}.${trimmedFrac}` : `${sign}${formattedWhole}`;
}

export function addRawAmounts(a: string, b: string): string {
  return (BigInt(a || '0') + BigInt(b || '0')).toString();
}

export function subRawAmounts(a: string, b: string): string {
  return (BigInt(a || '0') - BigInt(b || '0')).toString();
}

export function compareRawAmounts(a: string, b: string): -1 | 0 | 1 {
  const bigA = BigInt(a || '0');
  const bigB = BigInt(b || '0');
  if (bigA < bigB) return -1;
  if (bigA > bigB) return 1;
  return 0;
}
