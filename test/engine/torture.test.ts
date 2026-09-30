import { describe, expect, it } from "vitest";
import { generateObligations } from "../../src/scenarios/catalog";
import { amounts, expectConserved, run, usd } from "../helpers";

const recipients = (n: number, outstanding = "1000000.00") => Array.from({ length: n }, (_, i) => ({ id: `R${String(i).padStart(4, "0")}`, outstanding }));

describe("rounding torture cases", () => {
  it("$0.01 / 3 → one recipient gets the cent", () => {
    const { result } = run(usd("0.01", "equal", recipients(3)));
    expect(Object.values(amounts(result))).toEqual(["0.01", "0.00", "0.00"]);
    expectConserved(result);
  });

  it("$0.02 / 3 → two recipients get a cent", () => {
    const { result } = run(usd("0.02", "equal", recipients(3)));
    expect(Object.values(amounts(result))).toEqual(["0.01", "0.01", "0.00"]);
  });

  it("$100 / 3 → $33.34 / $33.33 / $33.33, never $99.99", () => {
    const { result } = run(usd("100.00", "equal", recipients(3)));
    expect(Object.values(amounts(result))).toEqual(["33.34", "33.33", "33.33"]);
    expect(result.totals.allocatedMinor).toBe(10000n);
    expect(result.rounding.residualMinor).toBe(1n);
    expect(result.rounding.adjustments).toEqual([expect.objectContaining({ obligationId: "R0000", rank: 1, adjustmentMinor: 1n })]);
    const first = result.lines[0].explanation;
    expect(first).toContain("Raw allocation: $33.333333…");
    expect(first).toContain("Rounded base (floor): $33.33");
    expect(first).toContain("Residual adjustment: +$0.01 (rank 1 of 1 by fractional remainder)");
    expect(first).toContain("Final: $33.34");
  });

  it("$10,000 / 7 → $1,428.57 × 7 is $9,999.99, so one residual cent goes to the first ID", () => {
    const { result } = run(usd("10000.00", "equal", recipients(7)));
    expect(Object.values(amounts(result))).toEqual(["1428.58", "1428.57", "1428.57", "1428.57", "1428.57", "1428.57", "1428.57"]);
    expect(result.rounding.residualMinor).toBe(1n);
  });

  it("identical fractional remainders are resolved by priority before ID", () => {
    const { result } = run(usd("100.00", "equal", [
      { id: "A", outstanding: "100.00", priority: 3 },
      { id: "B", outstanding: "100.00", priority: 1 },
      { id: "C", outstanding: "100.00", priority: 2 },
    ]));
    expect(amounts(result)).toEqual({ A: "33.33", B: "33.34", C: "33.33" });
  });

  it("very large amounts beyond 2^53 minor units stay exact", () => {
    const { result } = run(usd("123456789012345678.91", "equal", recipients(3, "999999999999999999.99")));
    expect(Object.values(amounts(result))).toEqual(["41152263004115226.31", "41152263004115226.30", "41152263004115226.30"]);
    expectConserved(result);
  });

  it("a one-cent residual across 1,000 recipients goes to exactly one", () => {
    const { result } = run(usd("10.01", "equal", recipients(1000)));
    expect(result.lines.filter((l) => l.allocatedMinor === 2n)).toHaveLength(1);
    expect(result.lines.filter((l) => l.allocatedMinor === 1n)).toHaveLength(999);
    expectConserved(result);
  });

  it("fewer cents than recipients: $0.07 across 1,000", () => {
    const { result } = run(usd("0.07", "equal", recipients(1000)));
    expect(result.lines.filter((l) => l.allocatedMinor === 1n).map((l) => l.obligationId)).toEqual(["R0000", "R0001", "R0002", "R0003", "R0004", "R0005", "R0006"]);
  });

  it("zero-decimal currency: ¥1,000 / 3 → ¥334 / ¥333 / ¥333", () => {
    const { result } = run({ amount: "1000", currency: "JPY", strategy: "equal", obligations: recipients(3, "5000") });
    expect(Object.values(amounts(result))).toEqual(["334", "333", "333"]);
  });

  it("three-decimal currency: KD 1.000 / 7 distributes six residual fils", () => {
    const { result } = run({ amount: "1.000", currency: "KWD", strategy: "equal", obligations: recipients(7, "10.000") });
    expect(Object.values(amounts(result))).toEqual(["0.143", "0.143", "0.143", "0.143", "0.143", "0.143", "0.142"]);
  });
});

describe("constraint torture cases", () => {
  it("an obligation smaller than its calculated share is capped and the surplus moves on", () => {
    const { result } = run(usd("300.00", "equal", [{ id: "SMALL", outstanding: "20.00" }, { id: "B", outstanding: "500.00" }, { id: "C", outstanding: "500.00" }]));
    expect(amounts(result)).toEqual({ SMALL: "20.00", B: "140.00", C: "140.00" });
    expect(result.lines[0].capped).toBe(true);
  });

  it("all obligations capped: the excess is reported as unallocated, not created or lost", () => {
    const { result } = run(usd("500.00", "proportional", [{ id: "A", outstanding: "100.00" }, { id: "B", outstanding: "150.00" }]));
    expect(amounts(result)).toEqual({ A: "100.00", B: "150.00" });
    expect(result.totals.unallocatedMinor).toBe(25000n);
    expect(result.warnings[0]).toContain("$250.00 could not be allocated");
    expectConserved(result);
  });

  it("allocation greater than total outstanding in the priority strategy", () => {
    const { result } = run(usd("1000.00", "priority", [{ id: "A", outstanding: "100.00" }]));
    expect(result.totals.unallocatedMinor).toBe(90000n);
  });

  it("maximums below outstanding are honoured", () => {
    const { result } = run(usd("1000.00", "proportional", [{ id: "A", outstanding: "900.00", max: "100.00" }, { id: "B", outstanding: "900.00" }]));
    expect(amounts(result)).toEqual({ A: "100.00", B: "900.00" });
  });

  it("minimums are allocated first and still respected after the split", () => {
    const { result } = run(usd("100.00", "proportional", [{ id: "A", outstanding: "1000.00" }, { id: "B", outstanding: "10.00", min: "10.00" }]));
    expect(amounts(result)).toEqual({ A: "90.00", B: "10.00" });
  });

  it("zero amount allocates nothing and still satisfies every invariant", () => {
    const { result } = run(usd("0.00", "proportional", [{ id: "A", outstanding: "10.00" }]));
    expect(amounts(result)).toEqual({ A: "0.00" });
    expectConserved(result);
  });

  it("zero outstanding balances receive nothing", () => {
    const { result } = run(usd("10.00", "equal", [{ id: "A", outstanding: "0.00" }, { id: "B", outstanding: "50.00" }]));
    expect(amounts(result)).toEqual({ A: "0.00", B: "10.00" });
  });

  it("hundreds of generated obligations keep every cent", () => {
    const { result } = run(usd("54321.99", "proportional", generateObligations(750, 7)));
    expectConserved(result);
    expect(result.totals.unallocatedMinor).toBe(0n);
    expect(result.rounding.residualMinor).toBeLessThan(750n);
  });
});
