import type { AllocationRequest, AllocationRule, EngineResult, Obligation, ProportionalBasis, StrategyId, ValidationIssue } from "./domain";
import { isCurrencyCode, type CurrencyCode } from "./money/currency";
import { parseMoney, toDecimalString } from "./money/money";
import { STRATEGIES } from "./strategies/registry";

/**
 * The JSON shape used by the HTTP API and the UI form. Money is always a
 * decimal string in major units ("4200.00"), never a JSON number: a JSON number
 * is a binary float once parsed, and "0.1" + "0.2" must stay exact.
 */
export interface WireObligation {
  id: string;
  description?: string;
  original?: string;
  outstanding: string;
  weight?: string;
  priority?: string | number;
  dueDate?: string;
  max?: string;
  min?: string;
  fixed?: string;
  excluded?: boolean;
}

export interface WireRule {
  kind: AllocationRule["kind"];
  obligationId: string;
  /** Amount for cap, minimum and fixed rules. */
  amount?: string;
  priority?: string | number;
  weight?: string;
  label?: string;
}

export interface WireAllocationRequest {
  amount: string;
  currency: string;
  strategy: string;
  obligations: WireObligation[];
  rules?: WireRule[];
  options?: { proportionalBasis?: ProportionalBasis };
}

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** Parses and validates untrusted JSON into an engine request, reporting every problem found. */
export function parseWireRequest(body: unknown): EngineResult<AllocationRequest> {
  const errors: ValidationIssue[] = [];
  const issue = (path: string, message: string) => errors.push({ path, message });
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: [{ path: "", message: "request body must be a JSON object" }] };
  }
  const b = body as Record<string, unknown>;

  const currency: CurrencyCode | null = isCurrencyCode(b.currency) ? b.currency : null;
  if (!currency) issue("currency", `"${String(b.currency ?? "")}" is not a supported currency`);
  const strategy = typeof b.strategy === "string" && Object.hasOwn(STRATEGIES, b.strategy) ? (b.strategy as StrategyId) : null;
  if (!strategy) issue("strategy", `"${String(b.strategy ?? "")}" is not a known strategy (${Object.keys(STRATEGIES).join(", ")})`);

  const money = (path: string, value: unknown, required: boolean): bigint | undefined => {
    if (isBlank(value)) {
      if (required) issue(path, "is required");
      return undefined;
    }
    if (typeof value === "number") {
      issue(path, `must be a decimal string such as "${Number.isFinite(value) ? value : "10.00"}", not a JSON number (floating point is not accepted for money)`);
      return undefined;
    }
    if (typeof value !== "string") {
      issue(path, "must be a decimal string");
      return undefined;
    }
    if (!currency) return undefined;
    const parsed = parseMoney(value, currency);
    if (!parsed.ok) {
      issue(path, parsed.error);
      return undefined;
    }
    return parsed.value;
  };

  const priorityOf = (path: string, value: unknown): number | undefined => {
    if (isBlank(value)) return undefined;
    const n = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) {
      issue(path, "must be a whole number ≥ 0");
      return undefined;
    }
    return n;
  };

  const text = (path: string, value: unknown): string | undefined => {
    if (isBlank(value)) return undefined;
    if (typeof value !== "string") {
      issue(path, "must be a string");
      return undefined;
    }
    return value.trim();
  };

  const amountMinor = money("amount", b.amount, true);

  const obligations: Obligation[] = [];
  if (!Array.isArray(b.obligations)) issue("obligations", "must be an array");
  else {
    b.obligations.forEach((raw, i) => {
      const at = (f: string) => `obligations[${i}].${f}`;
      if (typeof raw !== "object" || raw === null) {
        issue(`obligations[${i}]`, "must be an object");
        return;
      }
      const o = raw as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id.trim() : "";
      if (id === "") issue(at("id"), "is required");
      if (o.excluded !== undefined && typeof o.excluded !== "boolean") issue(at("excluded"), "must be true or false");
      const outstandingMinor = money(at("outstanding"), o.outstanding, true);
      obligations.push({
        id,
        description: text(at("description"), o.description),
        originalMinor: money(at("original"), o.original, false),
        outstandingMinor: outstandingMinor ?? 0n,
        weight: text(at("weight"), o.weight),
        priority: priorityOf(at("priority"), o.priority),
        dueDate: text(at("dueDate"), o.dueDate),
        maxMinor: money(at("max"), o.max, false),
        minMinor: money(at("min"), o.min, false),
        fixedMinor: money(at("fixed"), o.fixed, false),
        excluded: o.excluded === true ? true : undefined,
      });
    });
  }

  const rules: AllocationRule[] = [];
  if (b.rules !== undefined && !Array.isArray(b.rules)) issue("rules", "must be an array");
  (Array.isArray(b.rules) ? b.rules : []).forEach((raw, i) => {
    const at = (f: string) => `rules[${i}].${f}`;
    const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const obligationId = typeof r.obligationId === "string" ? r.obligationId.trim() : "";
    const label = text(at("label"), r.label);
    switch (r.kind) {
      case "cap": {
        const maxMinor = money(at("amount"), r.amount, true);
        if (maxMinor !== undefined) rules.push({ kind: "cap", obligationId, maxMinor, label });
        break;
      }
      case "minimum": {
        const minMinor = money(at("amount"), r.amount, true);
        if (minMinor !== undefined) rules.push({ kind: "minimum", obligationId, minMinor, label });
        break;
      }
      case "fixed": {
        const amount = money(at("amount"), r.amount, true);
        if (amount !== undefined) rules.push({ kind: "fixed", obligationId, amountMinor: amount, label });
        break;
      }
      case "exclude":
        rules.push({ kind: "exclude", obligationId, label });
        break;
      case "priority": {
        const priority = priorityOf(at("priority"), r.priority);
        if (priority === undefined) issue(at("priority"), "is required");
        else rules.push({ kind: "priority", obligationId, priority, label });
        break;
      }
      case "weight": {
        const weight = text(at("weight"), r.weight);
        if (weight === undefined) issue(at("weight"), "is required");
        else rules.push({ kind: "weight", obligationId, weight, label });
        break;
      }
      default:
        issue(at("kind"), `"${String(r.kind)}" is not a rule kind (cap, minimum, fixed, exclude, priority, weight)`);
    }
  });

  const basis = (b.options as Record<string, unknown> | undefined)?.proportionalBasis;
  if (basis !== undefined && basis !== "outstanding" && basis !== "original") issue("options.proportionalBasis", 'must be "outstanding" or "original"');

  if (errors.length > 0 || !currency || !strategy || amountMinor === undefined) return { ok: false, errors };
  return {
    ok: true,
    value: {
      amountMinor,
      currency,
      strategy,
      obligations,
      rules: rules.length > 0 ? rules : undefined,
      options: basis ? { proportionalBasis: basis as ProportionalBasis } : undefined,
    },
  };
}

/** Inverse of parseWireRequest, used to load a recorded calculation back into the editor. */
export function toWireRequest(request: AllocationRequest): WireAllocationRequest {
  const m = (v: bigint | undefined) => (v === undefined ? undefined : toDecimalString(v, request.currency));
  return {
    amount: toDecimalString(request.amountMinor, request.currency),
    currency: request.currency,
    strategy: request.strategy,
    obligations: request.obligations.map((o) => ({
      id: o.id,
      description: o.description,
      original: m(o.originalMinor),
      outstanding: toDecimalString(o.outstandingMinor, request.currency),
      weight: o.weight,
      priority: o.priority,
      dueDate: o.dueDate,
      max: m(o.maxMinor),
      min: m(o.minMinor),
      fixed: m(o.fixedMinor),
      excluded: o.excluded,
    })),
    rules: request.rules?.map((r) => ({
      kind: r.kind,
      obligationId: r.obligationId,
      label: r.label,
      amount: r.kind === "cap" ? m(r.maxMinor) : r.kind === "minimum" ? m(r.minMinor) : r.kind === "fixed" ? m(r.amountMinor) : undefined,
      priority: r.kind === "priority" ? r.priority : undefined,
      weight: r.kind === "weight" ? r.weight : undefined,
    })),
    options: request.options,
  };
}

/** Converts bigints to decimal strings (recursively) so a value can go through JSON.stringify. */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}
