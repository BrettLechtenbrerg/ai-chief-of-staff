import { MAX_MINOR_UNITS } from './types.js';

export function text(value: unknown, name: string, max = 80): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw new Error(`Invalid ${name}.`);
  }
  return value.trim();
}
export function minorUnits(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > MAX_MINOR_UNITS) {
    throw new Error('Amount must be bounded integer minor units.');
  }
  return value;
}
export function digits(value: unknown): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 0 || value > 4) throw new Error('Invalid currency precision.');
  return value;
}
export function currency(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) throw new Error('Use a three-letter currency code.');
  return value;
}
export function isoDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '2200-12-31') {
    throw new Error('Use a date between 1900 and 2200.');
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new Error('Invalid calendar date.');
  return value;
}

/** No floating-point multiplication or locale guessing. */
export function parseMoney(input: string, precision: number, decimal: '.' | ',' = '.'): number {
  digits(precision);
  if (typeof input !== 'string' || input.length > 80 || !['.', ','].includes(decimal)) throw new Error('Invalid amount.');
  let value = input.trim();
  let negative = false;
  if (/^\(.*\)$/.test(value)) { negative = true; value = value.slice(1,-1); }
  if (/^[+-]/.test(value)) {
    if (negative) throw new Error('Conflicting amount signs.');
    negative = value[0] === '-'; value = value.slice(1);
  }
  const separator = decimal === '.' ? ',' : '.';
  const pieces = value.split(decimal);
  if (pieces.length > 2) throw new Error('Invalid decimal amount.');
  const whole = pieces[0]; const fraction = pieces[1] ?? '';
  const groups = whole.split(separator);
  if (!groups.every(group => /^\d+$/.test(group)) ||
      (groups.length > 1 && (groups[0].length > 3 || groups.slice(1).some(group => group.length !== 3))) ||
      (pieces.length === 2 && !/^\d+$/.test(fraction)) || fraction.length > precision) {
    throw new Error('Amount does not match the selected decimal/precision convention.');
  }
  const amount = BigInt(groups.join('')) * (10n ** BigInt(precision)) + BigInt(fraction.padEnd(precision,'0') || '0');
  return minorUnits(Number(negative ? -amount : amount));
}
