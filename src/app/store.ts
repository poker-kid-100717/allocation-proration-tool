import { useSyncExternalStore } from "react";
import {
  deepFreeze,
  deserializeRecords,
  recordId,
  serializeRecords,
  type AllocationRecord,
  type AllocationRequest,
  type AllocationResult,
  type CalculationRecord,
  type ReversalRecord,
  type ReversalRequest,
  type ReversalResult,
  type WireAllocationRequest,
} from "../engine";
import { buildSeedRecords } from "./seed";

/**
 * Calculation history for this browser. Records are append-only and frozen;
 * the only destructive operation is clearing the records you created. Stored
 * in localStorage, so it is per-browser demo state, not a system of record.
 */
const STORAGE_KEY = "prorata.history.v1";

let seeds: CalculationRecord[] | null = null;
const getSeeds = () => (seeds ??= buildSeedRecords().map(deepFreeze));

function load(): CalculationRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? deserializeRecords(raw).map(deepFreeze) : [];
  } catch {
    return [];
  }
}

let userRecords: CalculationRecord[] | null = null;
let snapshot: CalculationRecord[] = [];
const listeners = new Set<() => void>();

function refresh() {
  userRecords ??= load();
  snapshot = [...userRecords, ...getSeeds()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, serializeRecords(userRecords ?? []));
  } catch {
    // Storage unavailable (private mode, quota): history lives for this tab only.
  }
  refresh();
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const getSnapshot = () => {
  if (userRecords === null) refresh();
  return snapshot;
};

export const useHistory = (): CalculationRecord[] => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

export const findRecord = (id: string) => getSnapshot().find((r) => r.id === id);

const entropy = () => (crypto.randomUUID?.() ?? Math.random().toString(16).slice(2)).replace(/-/g, "");

export function recordAllocation(request: AllocationRequest, result: AllocationResult, label: string, scenarioId?: string): AllocationRecord {
  const record: AllocationRecord = deepFreeze({ id: recordId("allocation", entropy()), kind: "allocation", createdAt: new Date().toISOString(), label, source: "user", scenarioId, request, result });
  userRecords = [...(userRecords ?? load()), record];
  persist();
  return record;
}

export function recordReversal(original: AllocationRecord, request: ReversalRequest, result: ReversalResult): ReversalRecord {
  const record: ReversalRecord = deepFreeze({
    id: recordId("reversal", entropy()),
    kind: "reversal",
    createdAt: new Date().toISOString(),
    label: request.reason || `Reversal of ${original.id}`,
    source: "user",
    reversesRecordId: original.id,
    request,
    result,
  });
  userRecords = [...(userRecords ?? load()), record];
  persist();
  return record;
}

export function clearUserRecords() {
  userRecords = [];
  persist();
}

export const reversalsOf = (records: readonly CalculationRecord[], allocationId: string) =>
  records.filter((r): r is ReversalRecord => r.kind === "reversal" && r.reversesRecordId === allocationId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

/** The Lab's working draft survives navigation between screens (not reloads). */
export interface LabDraft {
  readonly request: WireAllocationRequest;
  readonly label: string;
  readonly scenarioId?: string;
  /** Bumped when a draft is loaded from outside the Lab, so the editor resets. */
  readonly revision: number;
}

let draft: LabDraft | null = null;
export const getLabDraft = () => draft;
export function setLabDraft(next: Omit<LabDraft, "revision">) {
  draft = { ...next, revision: (draft?.revision ?? 0) + 1 };
}
export function updateLabDraft(next: Omit<LabDraft, "revision">) {
  draft = { ...next, revision: draft?.revision ?? 0 };
}
