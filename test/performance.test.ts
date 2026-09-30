import { describe, expect, it } from "vitest";
import { allocate, parseWireRequest } from "../src/engine";
import { generateObligations } from "../src/scenarios/catalog";

// Guard rails, not benchmarks (see bench/ for numbers). Limits are generous so
// slow CI runners don't flake, while an accidental O(n²) would still fail.
describe("performance", () => {
  it.each(["proportional", "priority", "equal"])("allocates across 10,000 obligations (%s) quickly and exactly", (strategy) => {
    const parsed = parseWireRequest({ amount: "9876543.21", currency: "USD", strategy, obligations: generateObligations(10_000) });
    if (!parsed.ok) throw new Error("invalid");
    const start = performance.now();
    const result = allocate(parsed.value);
    const elapsed = performance.now() - start;
    if (!result.ok) throw new Error("rejected");
    expect(result.value.totals.allocatedMinor).toBe(987654321n);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("stays fast through a long cascade of capping rounds", () => {
    // Capacities of 1..10,000 cents with equal weights: small obligations are capped
    // first, each cap raises everyone else's share, and thousands get capped in turn.
    const obligations = Array.from({ length: 10_000 }, (_, i) => ({ id: `C${String(i).padStart(5, "0")}`, outstandingMinor: BigInt(i + 1), weight: "1" }));
    const start = performance.now();
    const result = allocate({ amountMinor: 40_000_000n, currency: "USD", strategy: "weighted", obligations });
    if (!result.ok) throw new Error("rejected");
    expect(performance.now() - start).toBeLessThan(2_000);
    expect(result.value.totals.allocatedMinor).toBe(40_000_000n);
    expect(result.value.lines.filter((l) => l.capped).length).toBeGreaterThan(1_000);
  });
});
