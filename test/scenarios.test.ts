import { describe, expect, it } from "vitest";
import { reverseAllocation, toDecimalString } from "../src/engine";
import { buildScenarioRequest, generateObligations, SCENARIOS } from "../src/scenarios/catalog";
import { amounts, expectConserved, run } from "./helpers";

describe("built-in scenarios", () => {
  const cases = SCENARIOS.flatMap((s) => [{ s, v: undefined as string | undefined }, ...s.variants.map((v) => ({ s, v: v.id }))]);

  it.each(cases.map(({ s, v }) => [`${s.id}${v ? ` / ${v}` : ""}`, s.id, v] as const))("%s runs and conserves money", (_name, id, variant) => {
    const { result } = run(buildScenarioRequest(id, variant)!);
    expectConserved(result);
  });

  it("partial invoice payment: proportional vs oldest first", () => {
    expect(amounts(run(buildScenarioRequest("partial-invoice-payment", "proportional")!).result)).toEqual({ "INV-101": "3150.00", "INV-102": "2100.00", "INV-103": "2250.00" });
    expect(amounts(run(buildScenarioRequest("partial-invoice-payment", "oldest-first")!).result)).toEqual({ "INV-101": "4200.00", "INV-102": "2800.00", "INV-103": "500.00" });
  });

  it("marketplace settlement: $850 / $100 / $30 / $20, and exact on an odd total", () => {
    expect(amounts(run(buildScenarioRequest("marketplace-settlement")!).result)).toEqual({ MERCHANT: "850.00", PLATFORM: "100.00", PROCESSOR: "30.00", AFFILIATE: "20.00" });
    const odd = run(buildScenarioRequest("marketplace-settlement", "odd-total")!).result;
    expect(amounts(odd)).toEqual({ MERCHANT: "849.99", PLATFORM: "100.00", PROCESSOR: "30.00", AFFILIATE: "20.00" });
    expect(odd.rounding.residualMinor).toBe(3n);
    expect(amounts(run(buildScenarioRequest("marketplace-settlement", "fixed-fee")!).result)).toEqual({ MERCHANT: "850.00", PLATFORM: "100.00", PROCESSOR: "30.00", AFFILIATE: "20.00" });
  });

  it("processor fee allocation adds back up to the billed fee", () => {
    const { result } = run(buildScenarioRequest("processor-fee-allocation")!);
    expect(result.totals.allocatedMinor).toBe(8743n);
    expect(result.rounding.residualMinor).toBeGreaterThan(0n);
  });

  it("refund allocation reverses $150 / $100", () => {
    const original = run(buildScenarioRequest("refund-allocation")!);
    const scenario = SCENARIOS.find((s) => s.id === "refund-allocation")!;
    const r = reverseAllocation(original, { amountMinor: 25000n, method: scenario.reversal!.method });
    if (!r.ok) throw new Error("reversal failed");
    expect(r.value.lines.map((l) => toDecimalString(l.reversedMinor, "USD"))).toEqual(["150.00", "100.00"]);
  });

  it("credit allocation honours exclusion and the per-invoice cap", () => {
    expect(amounts(run(buildScenarioRequest("credit-allocation")!).result)).toEqual({ "INV-2031": "180.00", "INV-2044": "0.00", "INV-2051": "250.00", "INV-2063": "70.00" });
  });

  it("capped redistribution preserves the original repository's examples in cents", () => {
    expect(amounts(run(buildScenarioRequest("capped-redistribution")!).result)).toEqual({ "PART-A": "97.97", "PART-B": "1.03", "PART-C": "1.00" });
    const cascade = run(buildScenarioRequest("capped-redistribution", "two-rounds")!).result;
    expect(amounts(cascade)).toEqual({ "PART-A": "97.98", "PART-B": "1.02", "PART-C": "1.00" });
    expect(cascade.steps.filter((s) => s.message.startsWith("Round "))).toHaveLength(2);
    expect(run(buildScenarioRequest("capped-redistribution", "all-capped")!).result.totals.unallocatedMinor).toBe(9700n);
  });

  it("generated obligations are identical on every run", () => {
    expect(generateObligations(50)).toEqual(generateObligations(50));
    expect(generateObligations(50, 1)).not.toEqual(generateObligations(50, 2));
  });
});
