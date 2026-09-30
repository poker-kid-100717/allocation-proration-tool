import { describe, expect, it } from "vitest";
import { STRATEGY_LIST } from "../../src/engine";
import { amounts, errorsOf, expectConserved, run, usd } from "../helpers";

const invoices = [
  { id: "INV-101", outstanding: "4200.00", original: "5000.00", dueDate: "2026-05-15" },
  { id: "INV-102", outstanding: "2800.00", original: "2800.00", dueDate: "2026-06-01" },
  { id: "INV-103", outstanding: "3000.00", original: "3000.00", dueDate: "2026-06-15" },
];

describe("proportional", () => {
  it("allocates the flagship partial payment exactly", () => {
    const { result } = run(usd("7500.00", "proportional", invoices));
    expect(amounts(result)).toEqual({ "INV-101": "3150.00", "INV-102": "2100.00", "INV-103": "2250.00" });
    expect(result.totals.remainingOutstandingMinor).toBe(250000n);
    expect(result.rounding.residualMinor).toBe(0n);
    expectConserved(result);
  });

  it("can prorate by original amount instead of outstanding balance", () => {
    const { result } = run(usd("1080.00", "proportional", invoices, { options: { proportionalBasis: "original" } }));
    expect(amounts(result)).toEqual({ "INV-101": "500.00", "INV-102": "280.00", "INV-103": "300.00" });
  });

  it("requires original amounts for the original basis", () => {
    expect(errorsOf(usd("10.00", "proportional", [{ id: "A", outstanding: "5.00" }], { options: { proportionalBasis: "original" } }))[0]).toContain("original amount");
  });

  it("explains share, raw, base, adjustment and final for each line", () => {
    const { result } = run(usd("7500.00", "proportional", invoices));
    expect(result.lines[0].explanation).toEqual([
      "Outstanding: $4,200.00",
      "Share of outstanding balance: 42.00%",
      "Raw allocation: $3,150.00",
      "Rounded base (floor): $3,150.00",
      "Residual adjustment: $0.00",
      "Final: $3,150.00",
      "Remaining balance: $1,050.00",
    ]);
  });
});

describe("priority / oldest first", () => {
  it("fills obligations in full, in order, until the amount runs out", () => {
    const { result } = run(usd("5000.00", "priority", [
      { id: "B", outstanding: "4000.00", priority: 2 },
      { id: "A", outstanding: "3000.00", priority: 1 },
    ]));
    expect(amounts(result)).toEqual({ B: "2000.00", A: "3000.00" });
  });

  it("orders by due date when priorities tie, undated last, then by ID", () => {
    const { result } = run(usd("7500.00", "priority", [...invoices, { id: "INV-000", outstanding: "100.00" }]));
    expect(amounts(result)).toEqual({ "INV-101": "4200.00", "INV-102": "2800.00", "INV-103": "500.00", "INV-000": "0.00" });
  });

  it("never needs rounding", () => {
    const { result } = run(usd("0.03", "priority", [{ id: "A", outstanding: "0.01" }, { id: "B", outstanding: "0.01" }, { id: "C", outstanding: "0.05" }]));
    expect(amounts(result)).toEqual({ A: "0.01", B: "0.01", C: "0.01" });
    expect(result.rounding.residualMinor).toBe(0n);
  });
});

describe("equal", () => {
  it("splits evenly and re-splits what capped participants can't take", () => {
    const { result } = run(usd("90.00", "equal", [{ id: "A", outstanding: "10.00" }, { id: "B", outstanding: "100.00" }, { id: "C", outstanding: "100.00" }]));
    expect(amounts(result)).toEqual({ A: "10.00", B: "40.00", C: "40.00" });
  });
});

describe("weighted", () => {
  it("distributes a settlement by partner weights", () => {
    const { result } = run(usd("1000.00", "weighted", [
      { id: "A", outstanding: "1000.00", weight: "50" },
      { id: "B", outstanding: "1000.00", weight: "30" },
      { id: "C", outstanding: "1000.00", weight: "20" },
    ]));
    expect(amounts(result)).toEqual({ A: "500.00", B: "300.00", C: "200.00" });
    expect(result.warnings).toEqual([]);
  });

  it("normalises percentages that don't total 100 and says so", () => {
    const { result } = run(usd("97.00", "weighted", [
      { id: "A", outstanding: "1000.00", weight: "50" },
      { id: "B", outstanding: "1000.00", weight: "47" },
    ]));
    expect(amounts(result)).toEqual({ A: "50.00", B: "47.00" });
    expect(result.warnings[0]).toContain("Weights total 97, not 100");
  });

  it("accepts fractional weights", () => {
    const { result } = run(usd("100.00", "weighted", [{ id: "A", outstanding: "100.00", weight: "33.5" }, { id: "B", outstanding: "100.00", weight: "66.5" }]));
    expect(amounts(result)).toEqual({ A: "33.50", B: "66.50" });
  });

  it("requires a weight on every participant", () => {
    expect(errorsOf(usd("10.00", "weighted", [{ id: "A", outstanding: "10.00", weight: "1" }, { id: "B", outstanding: "10.00" }]))[0]).toContain("requires a weight");
  });
});

describe("fixed + remaining", () => {
  it("takes fixed amounts off the top and splits the rest by weight", () => {
    const { result } = run(usd("1000.00", "fixed-remainder", [
      { id: "MERCHANT", outstanding: "1000.00", weight: "85" },
      { id: "PLATFORM", outstanding: "1000.00", weight: "10" },
      { id: "PROCESSOR", outstanding: "1000.00", fixed: "30.00" },
      { id: "AFFILIATE", outstanding: "1000.00", weight: "2" },
    ]));
    expect(amounts(result)).toEqual({ MERCHANT: "850.00", PLATFORM: "100.00", PROCESSOR: "30.00", AFFILIATE: "20.00" });
  });

  it("splits the remainder by balance when no weights are given", () => {
    const { result } = run(usd("150.00", "fixed-remainder", [{ id: "FEE", outstanding: "50.00", fixed: "50.00" }, { id: "A", outstanding: "300.00" }, { id: "B", outstanding: "100.00" }]));
    expect(amounts(result)).toEqual({ FEE: "50.00", A: "75.00", B: "25.00" });
  });

  it("requires at least one fixed obligation", () => {
    expect(errorsOf(usd("10.00", "fixed-remainder", [{ id: "A", outstanding: "10.00" }]))[0]).toContain("at least one obligation with a fixed amount");
  });
});

describe("strategy registry", () => {
  it("gives every strategy an id, version, name and residual policy", () => {
    for (const s of STRATEGY_LIST) {
      expect(s.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.residualHandling.length).toBeGreaterThan(0);
    }
  });

  it("enforces caps in every strategy", () => {
    for (const s of STRATEGY_LIST) {
      const obligations = [
        { id: "A", outstanding: "100.00", max: "25.00", weight: "1" },
        { id: "B", outstanding: "100.00", weight: "1" },
        { id: "FEE", outstanding: "5.00", fixed: "5.00" },
      ];
      const { result } = run(usd("80.00", s.id, obligations));
      expect(result.lines[0].allocatedMinor).toBeLessThanOrEqual(2500n);
      expectConserved(result);
    }
  });
});
