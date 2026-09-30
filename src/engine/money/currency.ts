/**
 * Currency metadata. `minorUnits` is the ISO 4217 exponent: the number of
 * decimal places in the currency's smallest unit. Every monetary amount in
 * the engine is an integer count of that smallest unit, so precision is a
 * property of the currency rather than an assumption baked into arithmetic.
 */
export interface Currency {
  readonly code: string;
  readonly name: string;
  readonly symbol: string;
  readonly minorUnits: number;
}

const CURRENCIES = {
  USD: { code: "USD", name: "US Dollar", symbol: "$", minorUnits: 2 },
  EUR: { code: "EUR", name: "Euro", symbol: "€", minorUnits: 2 },
  GBP: { code: "GBP", name: "Pound Sterling", symbol: "£", minorUnits: 2 },
  CAD: { code: "CAD", name: "Canadian Dollar", symbol: "CA$", minorUnits: 2 },
  JPY: { code: "JPY", name: "Japanese Yen", symbol: "¥", minorUnits: 0 },
  KRW: { code: "KRW", name: "South Korean Won", symbol: "₩", minorUnits: 0 },
  KWD: { code: "KWD", name: "Kuwaiti Dinar", symbol: "KD ", minorUnits: 3 },
  BHD: { code: "BHD", name: "Bahraini Dinar", symbol: "BD ", minorUnits: 3 },
} as const satisfies Record<string, Currency>;

export type CurrencyCode = keyof typeof CURRENCIES;

export const SUPPORTED_CURRENCIES: readonly Currency[] = Object.values(CURRENCIES);

export function isCurrencyCode(code: unknown): code is CurrencyCode {
  return typeof code === "string" && Object.hasOwn(CURRENCIES, code);
}

export function getCurrency(code: CurrencyCode): Currency {
  return CURRENCIES[code];
}
