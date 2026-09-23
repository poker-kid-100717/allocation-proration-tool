import { describe, expect, it } from "vitest";
import { prorate, validateInput } from "../src/lib/prorate";

const expectAllocation = (actual: Record<string, number>, expected: Record<string, number>) => {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [name, amount] of Object.entries(expected)) {
    expect(actual[name]).toBeCloseTo(amount, 6);
  }
};

describe("prorate", () => {
  it("splits proportionally by historical average when demand exceeds supply", () => {
    const result = prorate({
      allocation_amount: 100,
      investor_amounts: [
        { name: "Investor A", requested_amount: 100, average_amount: 100 },
        { name: "Investor B", requested_amount: 25, average_amount: 25 },
      ],
    });
    expectAllocation(result, { "Investor A": 80, "Investor B": 20 });
  });

  it("gives everyone their full request when supply covers demand", () => {
    const result = prorate({
      allocation_amount: 200,
      investor_amounts: [
        { name: "Investor A", requested_amount: 100, average_amount: 100 },
        { name: "Investor B", requested_amount: 25, average_amount: 25 },
      ],
    });
    expectAllocation(result, { "Investor A": 100, "Investor B": 25 });
  });

  it("caps an investor at their request and redistributes the surplus", () => {
    const result = prorate({
      allocation_amount: 100,
      investor_amounts: [
        { name: "Investor A", requested_amount: 100, average_amount: 95 },
        { name: "Investor B", requested_amount: 2, average_amount: 1 },
        { name: "Investor C", requested_amount: 1, average_amount: 4 },
      ],
    });
    expectAllocation(result, { "Investor A": 97.96875, "Investor B": 1.03125, "Investor C": 1 });
  });

  it("caps multiple investors across successive rounds", () => {
    const result = prorate({
      allocation_amount: 100,
      investor_amounts: [
        { name: "Investor A", requested_amount: 100, average_amount: 95 },
        { name: "Investor B", requested_amount: 1, average_amount: 1 },
        { name: "Investor C", requested_amount: 1, average_amount: 4 },
      ],
    });
    expectAllocation(result, { "Investor A": 98, "Investor B": 1, "Investor C": 1 });
  });

  it("never allocates more than the available amount", () => {
    const result = prorate({
      allocation_amount: 50,
      investor_amounts: [
        { name: "A", requested_amount: 40, average_amount: 1 },
        { name: "B", requested_amount: 40, average_amount: 2 },
        { name: "C", requested_amount: 5, average_amount: 10 },
      ],
    });
    const total = Object.values(result).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(50, 6);
    expect(result.C).toBe(5);
  });

  it("splits evenly when nobody has an investment history", () => {
    const result = prorate({
      allocation_amount: 30,
      investor_amounts: [
        { name: "A", requested_amount: 100, average_amount: 0 },
        { name: "B", requested_amount: 100, average_amount: 0 },
        { name: "C", requested_amount: 100, average_amount: 0 },
      ],
    });
    expectAllocation(result, { A: 10, B: 10, C: 10 });
  });

  it("gives nothing to an investor who requested nothing", () => {
    const result = prorate({
      allocation_amount: 10,
      investor_amounts: [
        { name: "A", requested_amount: 0, average_amount: 100 },
        { name: "B", requested_amount: 20, average_amount: 1 },
      ],
    });
    expectAllocation(result, { A: 0, B: 10 });
  });
});

describe("validateInput", () => {
  const valid = {
    allocation_amount: 100,
    investor_amounts: [{ name: "A", requested_amount: 10, average_amount: 5 }],
  };

  it("accepts well-formed input", () => {
    expect(validateInput(valid)).toEqual({ ok: true, value: valid });
  });

  it.each([
    ["a non-object body", null],
    ["a negative allocation", { ...valid, allocation_amount: -1 }],
    ["a string allocation", { ...valid, allocation_amount: "100" }],
    ["an empty investor list", { ...valid, investor_amounts: [] }],
    ["a missing name", { ...valid, investor_amounts: [{ requested_amount: 1, average_amount: 1 }] }],
    ["a NaN amount", { ...valid, investor_amounts: [{ name: "A", requested_amount: NaN, average_amount: 1 }] }],
    [
      "duplicate names",
      {
        ...valid,
        investor_amounts: [
          { name: "A", requested_amount: 1, average_amount: 1 },
          { name: "A", requested_amount: 2, average_amount: 2 },
        ],
      },
    ],
  ])("rejects %s", (_label, body) => {
    expect(validateInput(body).ok).toBe(false);
  });
});
