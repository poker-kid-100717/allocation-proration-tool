import { getCurrency, type CurrencyCode } from "./currency";

/**
 * An exact non-negative rational number of minor units. Used for the
 * unrounded ("raw") share of an allocation, so the audit trail can show
 * $33.333333… without the engine ever holding it as a float.
 */
export interface Fraction {
  readonly num: bigint;
  readonly den: bigint;
}

export const fraction = (num: bigint, den: bigint): Fraction => {
  if (den <= 0n) throw new RangeError("Fraction denominator must be positive.");
  const g = gcd(num < 0n ? -num : num, den);
  return g > 1n ? { num: num / g, den: den / g } : { num, den };
};

export const wholeFraction = (value: bigint): Fraction => ({ num: value, den: 1n });

export function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/** a < b → negative, a == b → 0, a > b → positive. Exact cross-multiplication. */
export const compareFractions = (a: Fraction, b: Fraction): number => {
  const left = a.num * b.den;
  const right = b.num * a.den;
  return left < right ? -1 : left > right ? 1 : 0;
};

/**
 * Renders a fraction of minor units in major units, truncated to `extraDigits`
 * places beyond the currency's precision, with "…" when the expansion continues.
 * e.g. 10000/3 cents USD → "33.333333…".
 */
export function formatFraction(value: Fraction, currency: CurrencyCode, extraDigits = 4): string {
  const { minorUnits } = getCurrency(currency);
  const places = minorUnits + extraDigits;
  const scaled = (value.num * 10n ** BigInt(extraDigits)) / value.den;
  const exact = (value.num * 10n ** BigInt(extraDigits)) % value.den === 0n;
  const digits = scaled.toString().padStart(places + 1, "0");
  let whole = digits.slice(0, digits.length - places);
  let frac = digits.slice(digits.length - places);
  if (exact) {
    frac = frac.replace(/0+$/, "");
    if (frac.length < minorUnits) frac = frac.padEnd(minorUnits, "0");
  }
  whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${whole}${frac ? `.${frac}` : ""}${exact ? "" : "…"}`;
}

/** Percentage with fixed decimals, e.g. {42, 100} → "42.00%". Display only. */
export function formatPercent(value: Fraction, decimals = 2): string {
  if (value.den === 0n) return "—";
  const scale = 10n ** BigInt(decimals);
  const scaled = (value.num * 100n * scale * 2n + value.den) / (value.den * 2n); // round half up
  const s = scaled.toString().padStart(decimals + 1, "0");
  return `${s.slice(0, s.length - decimals)}${decimals ? `.${s.slice(s.length - decimals)}` : ""}%`;
}
