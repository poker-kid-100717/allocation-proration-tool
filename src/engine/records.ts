import type { AllocationRequest, AllocationResult, ReversalRequest, ReversalResult } from "./domain";

/**
 * A calculation record: the full input, the full output and when it was made.
 * Records are append-only. Changing an input produces a new record; a refund
 * produces a reversal record that references the allocation it unwinds.
 */
interface RecordBase {
  readonly id: string;
  readonly createdAt: string;
  readonly label: string;
  /** "seed" marks the demo records shipped with the app; "user" marks ones made in this browser. */
  readonly source: "seed" | "user";
}

export interface AllocationRecord extends RecordBase {
  readonly kind: "allocation";
  readonly scenarioId?: string;
  readonly request: AllocationRequest;
  readonly result: AllocationResult;
}

export interface ReversalRecord extends RecordBase {
  readonly kind: "reversal";
  readonly reversesRecordId: string;
  readonly request: ReversalRequest;
  readonly result: ReversalResult;
}

export type CalculationRecord = AllocationRecord | ReversalRecord;

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Record IDs look like ALC-1A2B3C4D / REV-1A2B3C4D. The random part comes from the caller. */
export const recordId = (kind: CalculationRecord["kind"], entropy: string) =>
  `${kind === "allocation" ? "ALC" : "REV"}-${entropy.replace(/[^0-9a-f]/gi, "").slice(0, 8).toUpperCase().padEnd(8, "0")}`;

// Storage encoding: bigints become {"$bigint": "123"} so they round-trip exactly.
const BIGINT_TAG = "$bigint";

export const serializeRecords = (records: readonly CalculationRecord[]): string =>
  JSON.stringify(records, (_key, value: unknown) => (typeof value === "bigint" ? { [BIGINT_TAG]: value.toString() } : value));

export function deserializeRecords(json: string): CalculationRecord[] {
  const parsed: unknown = JSON.parse(json, (_key, value: unknown) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const tagged = (value as Record<string, unknown>)[BIGINT_TAG];
      if (typeof tagged === "string" && /^-?\d+$/.test(tagged) && Object.keys(value).length === 1) return BigInt(tagged);
    }
    return value;
  });
  if (!Array.isArray(parsed)) throw new TypeError("Stored history is not an array.");
  return parsed.filter(
    (r): r is CalculationRecord =>
      typeof r === "object" && r !== null && typeof r.id === "string" && (r.kind === "allocation" || r.kind === "reversal") && typeof r.result === "object",
  );
}
