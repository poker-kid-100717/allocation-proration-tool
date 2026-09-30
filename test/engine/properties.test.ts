import { describe, expect, it } from "vitest";
import { allocate, type AllocationRequest, type Obligation, type StrategyId } from "../../src/engine";
import { seededRandom } from "../../src/scenarios/catalog";

/**
 * Property-style tests without a property-testing dependency: a seeded PRNG
 * generates hundreds of random requests, and each must satisfy the engine's
 * invariants. A failure prints its seed, so it can be replayed exactly.
 */
const STRATEGIES: StrategyId[] = ["proportional", "weighted", "equal", "priority", "fixed-remainder"];

function randomRequest(seed: number): AllocationRequest {
  const rand = seededRandom(seed);
  const int = (max: number) => Math.floor(rand() * max);
  const big = (max: number) => BigInt(int(max));
  const strategy = STRATEGIES[int(STRATEGIES.length)];
  const count = 1 + int(40);
  const obligations: Obligation[] = Array.from({ length: count }, (_, i) => {
    const outstandingMinor = rand() < 0.1 ? 0n : big(rand() < 0.5 ? 100 : 5_000_000);
    const o: { -readonly [K in keyof Obligation]: Obligation[K] } = {
      id: `O${int(1000)}-${i}`,
      outstandingMinor,
      weight: String(1 + int(100)) + (rand() < 0.3 ? `.${int(1000)}` : ""),
      priority: rand() < 0.5 ? int(5) : undefined,
    };
    if (rand() < 0.15) o.maxMinor = big(Number(outstandingMinor) + 1);
    if (rand() < 0.08) o.excluded = true;
    return o;
  });
  if (strategy === "fixed-remainder") {
    const target = obligations[0] as { -readonly [K in keyof Obligation]: Obligation[K] };
    target.excluded = undefined;
    target.maxMinor = undefined;
    target.fixedMinor = target.outstandingMinor / 2n;
  }
  const totalOutstanding = obligations.reduce((s, o) => s + o.outstandingMinor, 0n);
  const fixed = obligations.reduce((s, o) => s + (o.fixedMinor ?? 0n), 0n);
  // Sometimes under, sometimes over the total outstanding, sometimes tiny.
  const scale = rand();
  const amountMinor = fixed + (scale < 0.1 ? big(count) : scale < 0.8 ? (totalOutstanding * big(1000)) / 1000n : totalOutstanding + big(1_000_000));
  return { amountMinor, currency: rand() < 0.2 ? "JPY" : "USD", strategy, obligations };
}

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);

describe("invariants hold for 400 random requests", () => {
  it.each(SEEDS)("seed %i", (seed) => {
    const request = randomRequest(seed);
    const outcome = allocate(request);
    if (!outcome.ok) throw new Error(`seed ${seed} rejected: ${JSON.stringify(outcome.errors)}`);
    const { lines, totals } = outcome.value;

    const allocated = lines.reduce((s, l) => s + l.allocatedMinor, 0n);
    const capacity = lines.reduce((s, l, i) => s + (request.obligations[i].fixedMinor ?? l.capacityMinor), 0n);
    // sum(allocations) == amount whenever there is enough capacity; otherwise every line is full.
    expect(allocated).toBe(capacity >= request.amountMinor ? request.amountMinor : capacity);
    expect(allocated + totals.unallocatedMinor).toBe(request.amountMinor);

    request.obligations.forEach((o, i) => {
      const l = lines[i];
      expect(l.allocatedMinor >= 0n).toBe(true);
      expect(l.allocatedMinor <= o.outstandingMinor).toBe(true);
      expect(l.allocatedMinor <= (o.maxMinor ?? l.allocatedMinor)).toBe(true);
      expect(o.excluded ? l.allocatedMinor : 0n).toBe(0n);
      expect(l.allocatedMinor).toBe(o.fixedMinor ?? l.allocatedMinor);
    });
    // Residual is always fewer units than there are lines.
    expect(outcome.value.rounding.residualMinor < BigInt(lines.length)).toBe(true);
    expect(outcome.value.invariants.every((i) => i.holds)).toBe(true);
  });
});

describe("determinism", () => {
  it("same input ⇒ deep-equal output, including fingerprint and explanations", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      expect(allocate(randomRequest(seed))).toEqual(allocate(randomRequest(seed)));
    }
  });

  it("obligation order does not change who gets what", () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const request = randomRequest(seed);
      const reversed = { ...request, obligations: [...request.obligations].reverse() };
      const a = allocate(request);
      const b = allocate(reversed);
      if (!a.ok || !b.ok) throw new Error(`seed ${seed} rejected`);
      const byId = (lines: typeof a.value.lines) => Object.fromEntries(lines.map((l) => [l.obligationId, l.allocatedMinor]));
      expect(byId(b.value.lines)).toEqual(byId(a.value.lines));
    }
  });

  it("a different input produces a different fingerprint", () => {
    const a = allocate(randomRequest(1));
    const b = allocate({ ...randomRequest(1), amountMinor: randomRequest(1).amountMinor + 1n });
    if (!a.ok || !b.ok) throw new Error("rejected");
    expect(a.value.inputFingerprint).not.toBe(b.value.inputFingerprint);
  });

  it("does not depend on the process locale", () => {
    const request = randomRequest(7);
    const before = allocate(request);
    const original = String.prototype.localeCompare;
    // oxlint-disable-next-line no-extend-native -- temporarily booby-trap localeCompare to prove the engine never calls it
    String.prototype.localeCompare = () => {
      throw new Error("engine must not use locale-aware comparison");
    };
    try {
      expect(allocate(request)).toEqual(before);
    } finally {
      // oxlint-disable-next-line no-extend-native -- restore the original
      String.prototype.localeCompare = original;
    }
  });
});
