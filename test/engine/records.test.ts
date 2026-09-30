import { describe, expect, it } from "vitest";
import { deepFreeze, deserializeRecords, parseWireRequest, recordId, serializeRecords, toJsonSafe, toWireRequest, type AllocationRecord } from "../../src/engine";
import { buildScenarioRequest } from "../../src/scenarios/catalog";
import { run } from "../helpers";

describe("wire format", () => {
  it("round-trips a request through toWireRequest and parseWireRequest", () => {
    const wire = buildScenarioRequest("credit-allocation")!;
    const { request } = run(wire);
    expect(parseWireRequest(toWireRequest(request))).toEqual({ ok: true, value: request });
  });

  it("converts bigints to strings for JSON", () => {
    expect(toJsonSafe({ a: 1n, b: [2n, { c: 3n }], d: "x" })).toEqual({ a: "1", b: ["2", { c: "3" }], d: "x" });
  });
});

describe("calculation records", () => {
  const { request, result } = run(buildScenarioRequest("rounding-edge-case")!);
  const record: AllocationRecord = deepFreeze({ id: recordId("allocation", "abcdef0123"), kind: "allocation", createdAt: "2026-09-30T12:00:00.000Z", label: "test", source: "user", request, result });

  it("are immutable once created", () => {
    expect(Object.isFrozen(record.result.lines[0])).toBe(true);
    expect(() => {
      (record.result.lines[0] as { allocatedMinor: bigint }).allocatedMinor = 0n;
    }).toThrow(TypeError);
  });

  it("round-trip through storage with exact bigints", () => {
    const [restored] = deserializeRecords(serializeRecords([record]));
    expect(restored).toEqual(record);
    expect(typeof (restored as AllocationRecord).result.amountMinor).toBe("bigint");
  });

  it("have readable, prefixed IDs", () => {
    expect(record.id).toBe("ALC-ABCDEF01");
    expect(recordId("reversal", "12")).toBe("REV-12000000");
  });

  it("ignore malformed stored entries", () => {
    expect(deserializeRecords('[{"id":1},{"foo":"bar"}]')).toEqual([]);
    expect(() => deserializeRecords('{"not":"an array"}')).toThrow("not an array");
  });
});
