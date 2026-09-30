import { getCurrency, type CurrencyCode } from "./currency";

/**
 * An exact amount of money: an integer number of the currency's minor units
 * (cents for USD, yen for JPY, fils for KWD). `bigint` rather than `number`
 * means there is no binary floating point anywhere in the calculation path and
 * no 2^53 ceiling on amounts.
 */
export interface Money {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
}

export const money = (amountMinor: bigint, currency: CurrencyCode): Money => ({ amountMinor, currency });

/** Longest decimal string accepted for an amount (before the decimal point). */
export const MAX_AMOUNT_DIGITS = 18;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Parses a decimal string ("7,500.00", "0.01", "1000") into minor units without
 * ever converting to a JavaScript number. Rejects more fractional digits than
 * the currency supports rather than silently rounding user input.
 */
export function parseMoney(input: string, currency: CurrencyCode, { allowNegative = false } = {}): ParseResult<bigint> {
  const { minorUnits, code } = getCurrency(currency);
  const text = input.trim().replace(/,/g, "");
  if (text === "") return { ok: false, error: "is required" };

  const match = /^(-)?(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return { ok: false, error: `"${input}" is not a decimal amount` };
  const [, sign, whole, fraction = ""] = match;

  if (sign && !allowNegative) return { ok: false, error: "must not be negative" };
  if (whole.replace(/^0+/, "").length > MAX_AMOUNT_DIGITS) {
    return { ok: false, error: `exceeds ${MAX_AMOUNT_DIGITS} integer digits` };
  }
  if (fraction.length > minorUnits) {
    return {
      ok: false,
      error:
        minorUnits === 0
          ? `${code} has no minor unit; "${input}" must be a whole amount`
          : `${code} has ${minorUnits} decimal places; "${input}" has ${fraction.length}`,
    };
  }

  const minor = BigInt(whole + fraction.padEnd(minorUnits, "0"));
  return { ok: true, value: sign ? -minor : minor };
}

/** Plain decimal representation, e.g. 123456n USD → "1234.56". Round-trips through parseMoney. */
export function toDecimalString(amountMinor: bigint, currency: CurrencyCode): string {
  const { minorUnits } = getCurrency(currency);
  const negative = amountMinor < 0n;
  const digits = (negative ? -amountMinor : amountMinor).toString().padStart(minorUnits + 1, "0");
  const whole = digits.slice(0, digits.length - minorUnits);
  const fraction = digits.slice(digits.length - minorUnits);
  return `${negative ? "-" : ""}${whole}${minorUnits > 0 ? `.${fraction}` : ""}`;
}

const groupThousands = (whole: string) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Display formatting, e.g. 750000n USD → "$7,500.00". Exact for any magnitude. */
export function formatMoney(amountMinor: bigint, currency: CurrencyCode, { signed = false } = {}): string {
  const { symbol } = getCurrency(currency);
  const plain = toDecimalString(amountMinor < 0n ? -amountMinor : amountMinor, currency);
  const [whole, fraction] = plain.split(".");
  const body = `${symbol}${groupThousands(whole)}${fraction !== undefined ? `.${fraction}` : ""}`;
  if (amountMinor < 0n) return `−${body}`;
  return signed && amountMinor > 0n ? `+${body}` : body;
}

export const sumMinor = (values: Iterable<bigint>): bigint => {
  let total = 0n;
  for (const v of values) total += v;
  return total;
};

export const minBig = (a: bigint, b: bigint) => (a < b ? a : b);
export const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);
