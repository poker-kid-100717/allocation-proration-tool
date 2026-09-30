import { describe, expect, it } from "vitest";
import { reverseAllocation, toDecimalString, type ReversalResult } from "../../src/engine";
import { run, usd } from "../helpers";

const original = () =>
  run(usd("1000.00", "proportional", [
    { id: "INV-A", outstanding: "600.00", dueDate: "2026-07-01" },
    { id: "INV-B", outstanding: "400.00", dueDate: "2026-08-01" },
  ]));

const reversed = (r: ReversalResult) => Object.fromEntries(r.lines.map((l) => [l.obligationId, toDecimalString(l.reversedMinor, r.currency)]));

function reverse(...args: Parameters<typeof reverseAllocation>) {
  const r = reverseAllocation(...args);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
}

describe("reversals", () => {
  it("reverses a $250 refund in proportion to the original allocation", () => {
    const o = original();
    const r = reverse(o, { amountMinor: 25000n, method: "proportional" });
    expect(reversed(r)).toEqual({ "INV-A": "150.00", "INV-B": "100.00" });
    expect(r.totals).toEqual({ originallyAllocatedMinor: 100000n, previouslyReversedMinor: 0n, reversedMinor: 25000n, netAllocatedMinor: 75000n });
    expect(r.reversesFingerprint).toBe(o.result.inputFingerprint);
  });

  it("reverses last-applied first with reverse priority", () => {
    const r = reverse(original(), { amountMinor: 25000n, method: "reverse-priority" });
    expect(reversed(r)).toEqual({ "INV-A": "0.00", "INV-B": "250.00" });
  });

  it("does not modify the original allocation", () => {
    const o = original();
    const snapshot = structuredClone(o.result);
    reverse(o, { amountMinor: 33333n, method: "proportional" });
    expect(o.result).toEqual(snapshot);
  });

  it("rounds reversals with largest remainder and keeps the total exact", () => {
    const o = run(usd("100.00", "equal", [{ id: "A", outstanding: "50.00" }, { id: "B", outstanding: "50.00" }, { id: "C", outstanding: "50.00" }]));
    const r = reverse(o, { amountMinor: 1000n, method: "proportional" });
    // Net holdings 33.34 / 33.33 / 33.33; reversing $10.00.
    expect(reversed(r)).toEqual({ A: "3.34", B: "3.33", C: "3.33" });
    expect(r.lines.reduce((s, l) => s + l.reversedMinor, 0n)).toBe(1000n);
  });

  it("accounts for prior partial reversals and refuses to over-reverse", () => {
    const o = original();
    const first = reverse(o, { amountMinor: 60000n, method: "reverse-priority" });
    expect(reversed(first)).toEqual({ "INV-A": "200.00", "INV-B": "400.00" });
    const second = reverse(o, { amountMinor: 40000n, method: "proportional" }, [first]);
    expect(reversed(second)).toEqual({ "INV-A": "400.00", "INV-B": "0.00" });
    expect(second.totals.netAllocatedMinor).toBe(0n);

    const third = reverseAllocation(o, { amountMinor: 1n, method: "proportional" }, [first, second]);
    expect(third).toMatchObject({ ok: false, errors: [{ message: expect.stringContaining("exceeds the $0.00 still allocated") }] });
  });

  it("rejects zero, negative and mismatched reversals", () => {
    const o = original();
    expect(reverseAllocation(o, { amountMinor: 0n, method: "proportional" }).ok).toBe(false);
    expect(reverseAllocation(o, { amountMinor: -5n, method: "proportional" }).ok).toBe(false);
    expect(reverseAllocation(o, { amountMinor: 100001n, method: "proportional" }).ok).toBe(false);
    const tampered = { ...o, request: { ...o.request, amountMinor: 999n } };
    expect(reverseAllocation(tampered, { amountMinor: 1n, method: "proportional" }).ok).toBe(false);
    const other = run(usd("5.00", "equal", [{ id: "X", outstanding: "5.00" }]));
    const foreign = reverse(other, { amountMinor: 100n, method: "proportional" });
    expect(reverseAllocation(o, { amountMinor: 1n, method: "proportional" }, [foreign]).ok).toBe(false);
  });

  it("is deterministic", () => {
    const o = original();
    expect(reverse(o, { amountMinor: 12345n, method: "proportional" })).toEqual(reverse(o, { amountMinor: 12345n, method: "proportional" }));
  });
});
