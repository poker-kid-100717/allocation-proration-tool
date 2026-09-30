/**
 * Canonical JSON: object keys sorted, bigints as decimal strings, undefined
 * fields dropped. Two requests that mean the same thing serialise identically.
 */
export function canonicalJson(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * 64-bit FNV-1a over UTF-8 bytes, computed in four 16-bit limbs so it runs on
 * plain 32-bit integer math. A reproducibility fingerprint, not a security
 * control: it tells you two calculations had identical inputs.
 */
export function fnv1a64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  // Offset basis 0xcbf29ce484222325, least-significant limb first.
  let h0 = 0x2325, h1 = 0x8422, h2 = 0x9ce4, h3 = 0xcbf2;
  for (const byte of bytes) {
    h0 ^= byte;
    // Multiply by the FNV prime 0x100000001b3 = 2^40 + 0x1b3.
    const t0 = h0 * 0x1b3;
    let t1 = h1 * 0x1b3;
    let t2 = h2 * 0x1b3 + (h0 << 8);
    const t3 = h3 * 0x1b3 + (h1 << 8);
    t1 += t0 >>> 16;
    t2 += t1 >>> 16;
    h0 = t0 & 0xffff;
    h1 = t1 & 0xffff;
    h2 = t2 & 0xffff;
    h3 = (t3 + (t2 >>> 16)) & 0xffff;
  }
  return [h3, h2, h1, h0].map((h) => h.toString(16).padStart(4, "0")).join("");
}

export const fingerprint = (value: unknown) => fnv1a64(canonicalJson(value));
