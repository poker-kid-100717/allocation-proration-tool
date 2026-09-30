import { expect } from "vitest";
import { allocate, parseWireRequest, toDecimalString, type AllocationRequest, type AllocationResult, type WireAllocationRequest } from "../src/engine";

/** Parses a wire request, allocates it and fails the test on any validation error. */
export function run(wire: WireAllocationRequest): { request: AllocationRequest; result: AllocationResult } {
  const parsed = parseWireRequest(wire);
  if (!parsed.ok) throw new Error(`invalid request: ${JSON.stringify(parsed.errors)}`);
  const result = allocate(parsed.value);
  if (!result.ok) throw new Error(`allocation rejected: ${JSON.stringify(result.errors)}`);
  return { request: parsed.value, result: result.value };
}

/** Allocations keyed by obligation ID, as decimal strings. */
export function amounts(result: AllocationResult): Record<string, string> {
  return Object.fromEntries(result.lines.map((l) => [l.obligationId, toDecimalString(l.allocatedMinor, result.currency)]));
}

export function expectConserved(result: AllocationResult) {
  const total = result.lines.reduce((s, l) => s + l.allocatedMinor, 0n);
  expect(total).toBe(result.totals.allocatedMinor);
  expect(total + result.totals.unallocatedMinor).toBe(result.amountMinor);
  expect(result.invariants.every((i) => i.holds)).toBe(true);
}

export const errorsOf = (wire: unknown): string[] => {
  const parsed = parseWireRequest(wire);
  if (!parsed.ok) return parsed.errors.map((e) => `${e.path}: ${e.message}`);
  const result = allocate(parsed.value);
  return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
};

export const usd = (amount: string, strategy: string, obligations: WireAllocationRequest["obligations"], extra: Partial<WireAllocationRequest> = {}): WireAllocationRequest => ({
  amount,
  currency: "USD",
  strategy,
  obligations,
  ...extra,
});
