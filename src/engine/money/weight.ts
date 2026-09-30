/**
 * Weights are relative, non-negative decimals ("42", "33.5", "0.125"). They are
 * held as integers scaled by 10^WEIGHT_DECIMALS so weighted splits stay exact.
 */
export const WEIGHT_DECIMALS = 9;
const WEIGHT_SCALE = 10n ** BigInt(WEIGHT_DECIMALS);

export function parseWeight(text: string): { ok: true; value: bigint } | { ok: false; error: string } {
  const match = /^(\d{1,15})(?:\.(\d+))?$/.exec(text.trim().replace(/%$/, ""));
  if (!match) return { ok: false, error: `weight "${text}" must be a positive decimal number` };
  const [, whole, fraction = ""] = match;
  if (fraction.length > WEIGHT_DECIMALS) {
    return { ok: false, error: `weight "${text}" has more than ${WEIGHT_DECIMALS} decimal places` };
  }
  const value = BigInt(whole) * WEIGHT_SCALE + BigInt(fraction.padEnd(WEIGHT_DECIMALS, "0") || "0");
  if (value === 0n) return { ok: false, error: "weight must be greater than zero (exclude the obligation instead)" };
  return { ok: true, value };
}

/** Renders a scaled weight back as a decimal, e.g. 97000000000n → "97". */
export function formatWeight(scaled: bigint): string {
  const whole = scaled / WEIGHT_SCALE;
  const fraction = (scaled % WEIGHT_SCALE).toString().padStart(WEIGHT_DECIMALS, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

