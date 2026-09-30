import type { AllocationRequest, ValidationIssue } from "../domain";
import { isCurrencyCode } from "../money/currency";
import { STRATEGIES } from "../strategies/registry";
import { parseWeight } from "../money/weight";

/** Upper bound on obligations per request. Well above what the benchmarks exercise. */
export const MAX_OBLIGATIONS = 100_000;
export const MAX_ID_LENGTH = 64;
export const MAX_PRIORITY = 1_000_000_000;

const isIsoDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};

const isPriority = (p: unknown) => typeof p === "number" && Number.isSafeInteger(p) && p >= 0 && p <= MAX_PRIORITY;

/**
 * Structural validation: every field is individually well-formed. Constraints
 * that depend on several fields together (fixed amounts exceeding capacity,
 * minimums exceeding the payment) are checked after rules are resolved.
 */
export function validateRequest(request: AllocationRequest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });

  if (!isCurrencyCode(request.currency)) issue("currency", `"${String(request.currency)}" is not a supported currency`);
  if (!Object.hasOwn(STRATEGIES, request.strategy)) issue("strategy", `"${String(request.strategy)}" is not a known strategy`);
  if (typeof request.amountMinor !== "bigint") issue("amount", "must be an integer number of minor units");
  else if (request.amountMinor < 0n) issue("amount", "must not be negative (record refunds as reversals)");

  const { obligations } = request;
  if (obligations.length === 0) issue("obligations", "at least one obligation is required");
  if (obligations.length > MAX_OBLIGATIONS) issue("obligations", `at most ${MAX_OBLIGATIONS.toLocaleString("en-US")} obligations are supported`);

  const ids = new Map<string, number>();
  obligations.forEach((o, i) => {
    const at = (field: string) => `obligations[${i}].${field}`;
    if (typeof o.id !== "string" || o.id.trim() === "") issue(at("id"), "is required");
    else if (o.id !== o.id.trim()) issue(at("id"), `"${o.id}" has leading or trailing whitespace`);
    else if (o.id.length > MAX_ID_LENGTH) issue(at("id"), `must be at most ${MAX_ID_LENGTH} characters`);
    else if (ids.has(o.id)) issue(at("id"), `duplicate obligation ID "${o.id}" (also obligations[${ids.get(o.id)}])`);
    else ids.set(o.id, i);

    const amounts = [
      ["outstanding", o.outstandingMinor],
      ["original", o.originalMinor],
      ["max", o.maxMinor],
      ["min", o.minMinor],
      ["fixed", o.fixedMinor],
    ] as const;
    for (const [field, value] of amounts) {
      if (value === undefined && field !== "outstanding") continue;
      if (typeof value !== "bigint") issue(at(field), "must be an integer number of minor units");
      else if (value < 0n) issue(at(field), "must not be negative");
    }
    if (o.weight !== undefined) {
      const w = parseWeight(o.weight);
      if (!w.ok) issue(at("weight"), w.error);
    }
    if (o.priority !== undefined && !isPriority(o.priority)) issue(at("priority"), `must be a whole number from 0 to ${MAX_PRIORITY}`);
    if (o.dueDate !== undefined && !isIsoDate(o.dueDate)) issue(at("dueDate"), `"${o.dueDate}" is not a valid YYYY-MM-DD date`);
  });

  (request.rules ?? []).forEach((rule, i) => {
    const at = (field: string) => `rules[${i}].${field}`;
    if (!ids.has(rule.obligationId)) issue(at("obligationId"), `no obligation with ID "${rule.obligationId}"`);
    switch (rule.kind) {
      case "cap":
        if (rule.maxMinor < 0n) issue(at("max"), "must not be negative");
        break;
      case "minimum":
        if (rule.minMinor < 0n) issue(at("min"), "must not be negative");
        break;
      case "fixed":
        if (rule.amountMinor < 0n) issue(at("amount"), "must not be negative");
        break;
      case "priority":
        if (!isPriority(rule.priority)) issue(at("priority"), `must be a whole number from 0 to ${MAX_PRIORITY}`);
        break;
      case "weight": {
        const w = parseWeight(rule.weight);
        if (!w.ok) issue(at("weight"), w.error);
        break;
      }
      case "exclude":
        break;
      default:
        issue(at("kind"), `unknown rule kind "${(rule as { kind: unknown }).kind}"`);
    }
  });

  return issues;
}
