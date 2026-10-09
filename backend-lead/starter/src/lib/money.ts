import BigNumber from 'bignumber.js';

// Money invariants for this codebase:
// - Money is stored as DECIMAL(36,18) in Postgres and travels as strings in JS/JSON.
// - All arithmetic on money MUST go through BigNumber. Never use JS number math on money.
BigNumber.config({ DECIMAL_PLACES: 18, ROUNDING_MODE: BigNumber.ROUND_DOWN });

export function dec(value: string | number | BigNumber): BigNumber {
  const bn = new BigNumber(value);
  if (!bn.isFinite()) {
    throw new Error(`Invalid money value: ${value}`);
  }
  return bn;
}

export const ZERO = dec(0);

const MONEY_LIMIT = dec('1000000000000000000');

// DECIMAL(36,18) has 18 digits to either side of the decimal point.
export function fitsMoney(value: BigNumber): boolean {
  return value.isFinite() && value.abs().isLessThan(MONEY_LIMIT) && (value.decimalPlaces() ?? Infinity) <= 18;
}

export function isPositiveMoney(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d+(?:\.\d{1,18})?$/.test(value) &&
    dec(value).isGreaterThan(ZERO) &&
    fitsMoney(dec(value))
  );
}
