import { allocate, parseMoney, parseWireRequest, reverseAllocation, type AllocationRecord, type CalculationRecord, type ReversalRecord } from "../engine";
import { buildScenarioRequest, getScenario } from "../scenarios/catalog";

/**
 * Demo history shipped with the app so the dashboard and audit views have
 * something to show on first visit. These are ordinary engine calculations
 * with fixed IDs and timestamps, labelled "Seeded demo" wherever they appear.
 */
const SEEDS: { id: string; at: string; scenario: string; variant?: string; label: string }[] = [
  { id: "ALC-5EED0001", at: "2026-09-28T14:05:00.000Z", scenario: "partial-invoice-payment", variant: "proportional", label: "Northwind Traders: partial payment, pro rata" },
  { id: "ALC-5EED0002", at: "2026-09-28T15:40:00.000Z", scenario: "marketplace-settlement", variant: "odd-total", label: "Marketplace settlement: $999.99 order" },
  { id: "ALC-5EED0003", at: "2026-09-29T09:12:00.000Z", scenario: "processor-fee-allocation", label: "Processor batch fee: 7 card transactions" },
  { id: "ALC-5EED0004", at: "2026-09-29T11:30:00.000Z", scenario: "refund-allocation", label: "Payment across Invoice A and Invoice B" },
  { id: "ALC-5EED0006", at: "2026-09-29T16:02:00.000Z", scenario: "credit-allocation", label: "$500 service credit, oldest first" },
  { id: "ALC-5EED0007", at: "2026-09-30T08:45:00.000Z", scenario: "rounding-edge-case", label: "$100.00 ÷ 3 recipients" },
];

export function buildSeedRecords(): CalculationRecord[] {
  const records: CalculationRecord[] = [];
  for (const s of SEEDS) {
    const parsed = parseWireRequest(buildScenarioRequest(s.scenario, s.variant));
    if (!parsed.ok) continue;
    const result = allocate(parsed.value);
    if (!result.ok) continue;
    const record: AllocationRecord = { id: s.id, kind: "allocation", createdAt: s.at, label: s.label, source: "seed", scenarioId: s.scenario, request: parsed.value, result: result.value };
    records.push(record);

    const reversal = getScenario(s.scenario)?.reversal;
    if (reversal) {
      const amount = parseMoney(reversal.amount, parsed.value.currency);
      if (!amount.ok) continue;
      const request = { amountMinor: amount.value, method: reversal.method, reason: reversal.reason };
      const r = reverseAllocation({ request: parsed.value, result: result.value }, request);
      if (r.ok) {
        const rev: ReversalRecord = { id: "REV-5EED0005", kind: "reversal", createdAt: "2026-09-29T13:10:00.000Z", label: reversal.reason, source: "seed", reversesRecordId: s.id, request, result: r.value };
        records.push(rev);
      }
    }
  }
  return records;
}
