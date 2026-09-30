import { describe, expect, it } from "vitest";
import { canonicalJson, fnv1a64, formatFraction, formatMoney, formatPercent, fraction, getCurrency, parseMoney, parseWeight, SUPPORTED_CURRENCIES, toDecimalString } from "../../src/engine";

describe("parseMoney", () => {
  it.each([
    ["10.25", "USD", 1025n],
    ["4,200.00", "USD", 420000n],
    ["0.01", "USD", 1n],
    ["7", "USD", 700n],
    ["7.5", "USD", 750n],
    ["1000", "JPY", 1000n],
    ["1.234", "KWD", 1234n],
    ["999999999999999999.99", "USD", 99999999999999999999n],
  ] as const)("parses %s %s exactly", (text, currency, minor) => {
    expect(parseMoney(text, currency)).toEqual({ ok: true, value: minor });
  });

  it("never goes through floating point: 0.1 + 0.2 stays exact", () => {
    const a = parseMoney("0.1", "USD");
    const b = parseMoney("0.2", "USD");
    if (!a.ok || !b.ok) throw new Error("parse failed");
    expect(toDecimalString(a.value + b.value, "USD")).toBe("0.30");
  });

  it.each([
    ["", "USD", "is required"],
    ["abc", "USD", "not a decimal amount"],
    ["1e3", "USD", "not a decimal amount"],
    ["NaN", "USD", "not a decimal amount"],
    ["Infinity", "USD", "not a decimal amount"],
    ["-5.00", "USD", "must not be negative"],
    ["10.001", "USD", "USD has 2 decimal places"],
    ["100.5", "JPY", "JPY has no minor unit"],
    ["1.2345", "KWD", "KWD has 3 decimal places"],
    ["1".repeat(19), "USD", "exceeds 18 integer digits"],
  ] as const)("rejects %j in %s", (text, currency, message) => {
    expect(parseMoney(text, currency)).toEqual({ ok: false, error: expect.stringContaining(message) });
  });

  it("allows negatives only when asked", () => {
    expect(parseMoney("-1.50", "USD", { allowNegative: true })).toEqual({ ok: true, value: -150n });
  });
});

describe("formatting", () => {
  it("formats by currency precision", () => {
    expect(formatMoney(750000n, "USD")).toBe("$7,500.00");
    expect(formatMoney(1n, "USD")).toBe("$0.01");
    expect(formatMoney(334n, "JPY")).toBe("¥334");
    expect(formatMoney(143n, "KWD")).toBe("KD 0.143");
    expect(formatMoney(-2500n, "EUR")).toBe("−€25.00");
    expect(formatMoney(1n, "USD", { signed: true })).toBe("+$0.01");
  });

  it("formats amounts far beyond Number.MAX_SAFE_INTEGER without losing digits", () => {
    expect(formatMoney(123456789012345678901n, "USD")).toBe("$1,234,567,890,123,456,789.01");
  });

  it("round-trips every supported currency through parse and toDecimalString", () => {
    for (const { code, minorUnits } of SUPPORTED_CURRENCIES) {
      const text = minorUnits === 0 ? "12345" : `12345.${"6".repeat(minorUnits)}`;
      const parsed = parseMoney(text, code as never);
      expect(parsed.ok && toDecimalString(parsed.value, code as never)).toBe(text);
    }
  });

  it("shows exact raw shares with an ellipsis when they repeat", () => {
    expect(formatFraction(fraction(10000n, 3n), "USD")).toBe("33.333333…");
    expect(formatFraction(fraction(315000n, 1n), "USD")).toBe("3,150.00");
    expect(formatFraction(fraction(1n, 8n), "USD")).toBe("0.00125");
    expect(formatPercent(fraction(42n, 100n))).toBe("42.00%");
    expect(formatPercent(fraction(1n, 3n))).toBe("33.33%");
  });

  it("knows currency precision", () => {
    expect(getCurrency("USD").minorUnits).toBe(2);
    expect(getCurrency("JPY").minorUnits).toBe(0);
    expect(getCurrency("KWD").minorUnits).toBe(3);
  });
});

describe("weights", () => {
  it("parses decimal weights exactly and rejects zero", () => {
    expect(parseWeight("42")).toEqual({ ok: true, value: 42_000_000_000n });
    expect(parseWeight("33.5%")).toEqual({ ok: true, value: 33_500_000_000n });
    expect(parseWeight("0").ok).toBe(false);
    expect(parseWeight("-1").ok).toBe(false);
    expect(parseWeight("0.0000000001").ok).toBe(false);
  });
});

describe("fingerprint", () => {
  it("matches published FNV-1a 64 test vectors", () => {
    expect(fnv1a64("")).toBe("cbf29ce484222325");
    expect(fnv1a64("a")).toBe("af63dc4c8601ec8c");
    expect(fnv1a64("foobar")).toBe("85944171f73967e8");
  });

  it("canonicalises key order and bigints", () => {
    expect(canonicalJson({ b: 1n, a: [2n, "x"], c: undefined })).toBe('{"a":["2","x"],"b":"1"}');
  });
});
