import { describe, expect, it } from "vitest";
import { apportion, type Claimant } from "../../src/engine";

const c = (id: string, weight: bigint, capacity: bigint, priority = 0): Claimant => ({ id, weight, capacity, priority });
const alloc = (pool: bigint, claimants: Claimant[]) => {
  const r = apportion(pool, claimants);
  return Object.fromEntries([...r.shares].map(([id, s]) => [id, s.allocated]));
};

const three = (pa: number, pb: number, pc: number) => alloc(100n, [c("C", 1n, 999n, pc), c("B", 1n, 999n, pb), c("A", 1n, 999n, pa)]);

describe("apportion (capped largest remainder)", () => {
  it("splits exactly when shares are whole", () => {
    expect(alloc(750000n, [c("A", 420000n, 420000n), c("B", 280000n, 280000n), c("C", 300000n, 300000n)])).toEqual({ A: 315000n, B: 210000n, C: 225000n });
  });

  it("gives the residual cent to the largest remainder", () => {
    // Weights 7:3 on 1,001 units: exact shares 700.7 and 300.3 → floors 700 + 300, residual 1 to A (.7 > .3).
    expect(alloc(1001n, [c("A", 7n, 10_000n), c("B", 3n, 10_000n)])).toEqual({ A: 701n, B: 300n });
  });

  it("breaks equal remainders by priority, then ID", () => {
    expect(three(0, 0, 0)).toEqual({ A: 34n, B: 33n, C: 33n });
    expect(three(5, 5, 1)).toEqual({ A: 33n, B: 33n, C: 34n });
  });

  // The original repository's capped-redistribution examples, now in exact cents.
  it("redistributes a capped claimant's surplus (legacy example 1)", () => {
    expect(alloc(10000n, [c("A", 100n, 10000n), c("B", 25n, 2500n)])).toEqual({ A: 8000n, B: 2000n });
  });

  it("gives everyone their capacity when supply covers demand (legacy example 2)", () => {
    const r = apportion(20000n, [c("A", 100n, 10000n), c("B", 25n, 2500n)]);
    expect(r.shares.get("A")?.allocated).toBe(10000n);
    expect(r.shares.get("B")?.allocated).toBe(2500n);
    expect(r.unallocated).toBe(7500n);
  });

  it("caps and re-splits with largest remainder (legacy example 3: 97.96875 / 1.03125 / 1 → cents)", () => {
    expect(alloc(10000n, [c("A", 95n, 10000n), c("B", 1n, 200n), c("C", 4n, 100n)])).toEqual({ A: 9797n, B: 103n, C: 100n });
  });

  it("caps several claimants at once (legacy example 4)", () => {
    const r = apportion(10000n, [c("A", 95n, 10000n), c("B", 1n, 100n), c("C", 4n, 100n)]);
    expect(Object.fromEntries([...r.shares].map(([id, s]) => [id, s.allocated]))).toEqual({ A: 9800n, B: 100n, C: 100n });
    expect(r.rounds).toHaveLength(1);
    expect(r.rounds[0].capped).toEqual(["C", "B"]);
  });

  it("records cascading rounds when capping one claimant pushes another over", () => {
    const r = apportion(10000n, [c("A", 95n, 10000n), c("B", 1n, 102n), c("C", 4n, 100n)]);
    expect(r.rounds.map((x) => x.capped)).toEqual([["C"], ["B"]]);
    expect(r.shares.get("A")?.allocated).toBe(9798n);
  });

  it("never lets the residual unit break a cap", () => {
    // Shares 33.33… each against a cap of 34: base 33 + 1 = 34 is allowed; cap 33 would have been hit exactly.
    const r = alloc(100n, [c("A", 1n, 34n), c("B", 1n, 34n), c("C", 1n, 34n)]);
    expect(Object.values(r).every((v) => v <= 34n)).toBe(true);
    expect(Object.values(r).reduce((a, b) => a + b)).toBe(100n);
  });

  it("ignores zero-weight and zero-capacity claimants", () => {
    expect(alloc(100n, [c("A", 0n, 100n), c("B", 1n, 0n), c("C", 1n, 500n)])).toEqual({ A: 0n, B: 0n, C: 100n });
  });

  it("reports unallocated money instead of losing it when everyone is capped", () => {
    const r = apportion(500n, [c("A", 1n, 100n), c("B", 1n, 150n)]);
    expect(r.unallocated).toBe(250n);
  });

  it("rejects a negative pool", () => {
    expect(() => apportion(-1n, [c("A", 1n, 1n)])).toThrow(RangeError);
  });
});
