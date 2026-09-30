import { describe, expect, it } from "vitest";
import { allocate, InvariantViolation } from "../../src/engine";
import { amounts, errorsOf, run, usd } from "../helpers";

const ok = [{ id: "A", outstanding: "10.00" }];

describe("input validation", () => {
  it.each([
    ["a non-object body", null, "request body must be a JSON object"],
    ["a negative amount", usd("-5.00", "equal", ok), "amount: must not be negative"],
    ["a JSON-number amount", { ...usd("1", "equal", ok), amount: 10.5 }, "not a JSON number"],
    ["NaN", { ...usd("1", "equal", ok), amount: Number.NaN }, "not a JSON number"],
    ["Infinity", { ...usd("1", "equal", ok), amount: "Infinity" }, "not a decimal amount"],
    ["an unknown currency", { ...usd("1", "equal", ok), currency: "XYZ" }, 'currency: "XYZ" is not a supported currency'],
    ["too many decimals for the currency", usd("1.001", "equal", ok), "USD has 2 decimal places"],
    ["an unknown strategy", usd("1.00", "magic", ok), 'strategy: "magic" is not a known strategy'],
    ["no obligations", usd("1.00", "equal", []), "at least one obligation is required"],
    ["a duplicate obligation ID", usd("1.00", "equal", [{ id: "A", outstanding: "1.00" }, { id: "A", outstanding: "2.00" }]), 'duplicate obligation ID "A"'],
    ["a missing ID", usd("1.00", "equal", [{ id: " ", outstanding: "1.00" }]), "obligations[0].id: is required"],
    ["a negative outstanding balance", usd("1.00", "equal", [{ id: "A", outstanding: "-1.00" }]), "obligations[0].outstanding: must not be negative"],
    ["a zero weight", usd("1.00", "weighted", [{ id: "A", outstanding: "1.00", weight: "0" }]), "weight must be greater than zero"],
    ["an invalid percentage", usd("1.00", "weighted", [{ id: "A", outstanding: "1.00", weight: "abc%" }]), "must be a positive decimal number"],
    ["a fractional priority", usd("1.00", "priority", [{ id: "A", outstanding: "1.00", priority: 1.5 }]), "priority: must be a whole number"],
    ["an impossible due date", usd("1.00", "priority", [{ id: "A", outstanding: "1.00", dueDate: "2026-02-30" }]), "not a valid YYYY-MM-DD date"],
    ["a rule for an unknown obligation", usd("1.00", "equal", ok, { rules: [{ kind: "exclude", obligationId: "NOPE" }] }), 'no obligation with ID "NOPE"'],
    ["an unknown rule kind", usd("1.00", "equal", ok, { rules: [{ kind: "teleport" as never, obligationId: "A" }] }), '"teleport" is not a rule kind'],
  ])("rejects %s", (_label, body, message) => {
    expect(errorsOf(body).join("\n")).toContain(message);
  });

  it("reports every problem at once, with paths", () => {
    const errors = errorsOf(usd("x", "equal", [{ id: "", outstanding: "-1" }, { id: "B", outstanding: "1.001" }]));
    expect(errors).toEqual([
      'amount: "x" is not a decimal amount',
      "obligations[0].id: is required",
      "obligations[0].outstanding: must not be negative",
      "obligations[1].outstanding: USD has 2 decimal places; \"1.001\" has 3",
    ]);
  });
});

describe("constraint validation", () => {
  it.each([
    ["fixed above outstanding", [{ id: "A", outstanding: "10.00", fixed: "11.00" }], "fixed allocation $11.00 exceeds its allocatable capacity $10.00"],
    ["fixed above a maximum", [{ id: "A", outstanding: "10.00", max: "5.00", fixed: "6.00" }], "exceeds its allocatable capacity $5.00"],
    ["minimum above outstanding", [{ id: "A", outstanding: "10.00", min: "12.00" }], "minimum allocation $12.00 exceeds"],
    ["fixed and minimum together", [{ id: "A", outstanding: "10.00", min: "1.00", fixed: "2.00" }], "both a fixed and a minimum"],
    ["an excluded obligation with a fixed amount", [{ id: "A", outstanding: "10.00", fixed: "2.00", excluded: true }], "excluded but also has a fixed"],
    ["fixed amounts exceeding the payment", [{ id: "A", outstanding: "100.00", fixed: "60.00" }, { id: "B", outstanding: "100.00", fixed: "50.00" }], "cannot cover the fixed ($110.00)"],
  ])("rejects %s", (_label, obligations, message) => {
    expect(errorsOf(usd("100.00", "proportional", obligations)).join("\n")).toContain(message);
  });

  it("rejects conflicting fixed rules", () => {
    const errors = errorsOf(usd("100.00", "proportional", [{ id: "A", outstanding: "100.00", fixed: "10.00" }], { rules: [{ kind: "fixed", obligationId: "A", amount: "20.00" }] }));
    expect(errors.join()).toContain("conflicting fixed amounts");
  });
});

describe("rules", () => {
  const invoices = [
    { id: "INV-1", outstanding: "180.00", dueDate: "2026-03-01" },
    { id: "INV-2", outstanding: "260.00", dueDate: "2026-03-15" },
    { id: "INV-3", outstanding: "400.00", dueDate: "2026-04-01" },
    { id: "INV-4", outstanding: "90.00", dueDate: "2026-04-20" },
  ];

  it("applies exclude and cap rules and records them for the audit", () => {
    const { result } = run(
      usd("500.00", "priority", invoices, {
        rules: [
          { kind: "exclude", obligationId: "INV-2", label: "Disputed" },
          { kind: "cap", obligationId: "INV-3", amount: "250.00" },
        ],
      }),
    );
    expect(amounts(result)).toEqual({ "INV-1": "180.00", "INV-2": "0.00", "INV-3": "250.00", "INV-4": "70.00" });
    expect(result.appliedRules).toEqual([
      { obligationId: "INV-2", kind: "exclude", description: "excluded from this allocation", source: "request", label: "Disputed" },
      { obligationId: "INV-3", kind: "cap", description: "maximum allocation $250.00", source: "request", label: undefined },
    ]);
  });

  it("combines caps by taking the lowest", () => {
    const { result } = run(usd("500.00", "priority", [{ id: "A", outstanding: "400.00", max: "300.00" }], { rules: [{ kind: "cap", obligationId: "A", amount: "350.00" }] }));
    expect(amounts(result)).toEqual({ A: "300.00" });
  });

  it("lets a priority rule reorder a waterfall", () => {
    const { result } = run(usd("200.00", "priority", invoices, { rules: [{ kind: "priority", obligationId: "INV-4", priority: 0 }] }));
    expect(amounts(result)).toEqual({ "INV-1": "110.00", "INV-2": "0.00", "INV-3": "0.00", "INV-4": "90.00" });
  });

  it("lets a weight rule override an obligation's weight", () => {
    const { result } = run(usd("100.00", "weighted", [{ id: "A", outstanding: "100.00", weight: "1" }, { id: "B", outstanding: "100.00", weight: "1" }], { rules: [{ kind: "weight", obligationId: "B", weight: "3" }] }));
    expect(amounts(result)).toEqual({ A: "25.00", B: "75.00" });
  });

  it("applies a minimum rule before the split", () => {
    const { result } = run(usd("100.00", "proportional", [{ id: "A", outstanding: "1000.00" }, { id: "B", outstanding: "100.00" }], { rules: [{ kind: "minimum", obligationId: "B", amount: "50.00" }] }));
    // $50 to B first, then $50 split by balance 1000:100 → A $45.4545…, B $4.5454…;
    // B's remainder (0.545¢) beats A's (0.454¢), so B takes the residual cent.
    expect(amounts(result)).toEqual({ A: "45.45", B: "54.55" });
  });
});

describe("InvariantViolation", () => {
  it("is what the engine throws if a result would break an invariant", () => {
    const err = new InvariantViolation([{ name: "Conservation of money", holds: false, detail: "x" }]);
    expect(err.message).toContain("Conservation of money");
    expect(err).toBeInstanceOf(Error);
  });

  it("is not thrown for valid input", () => {
    expect(() => allocate({ amountMinor: 1n, currency: "USD", strategy: "equal", obligations: [{ id: "A", outstandingMinor: 5n }] })).not.toThrow();
  });
});
