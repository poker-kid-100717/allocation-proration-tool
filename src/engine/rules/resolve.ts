import type { AllocationRequest, AppliedRule, Obligation, ValidationIssue } from "../domain";
import { formatMoney, minBig, maxBig } from "../money/money";
import { parseWeight } from "../money/weight";

/** Priority used when none is given: served after every explicitly prioritised obligation. */
export const UNPRIORITISED = Number.MAX_SAFE_INTEGER;

/** An obligation with every rule folded in: the constraints the engine actually enforces. */
export interface EffectiveObligation {
  readonly obligation: Obligation;
  readonly index: number;
  readonly capacity: bigint;
  readonly minimum: bigint;
  readonly fixed: bigint | null;
  readonly excluded: boolean;
  readonly priority: number;
  /** Weight scaled to an integer, or null when none was supplied. */
  readonly weight: bigint | null;
}

/**
 * Folds obligation-level constraints and request-level rules into one
 * effective constraint set per obligation, and records every rule in effect
 * for the audit trail. Combination is order-independent: caps take the
 * minimum, minimums the maximum, request rules replace priority and weight,
 * and conflicting fixed amounts are an error rather than a silent choice.
 */
export function resolveRules(request: AllocationRequest): { effective: EffectiveObligation[]; applied: AppliedRule[]; errors: ValidationIssue[] } {
  const { currency } = request;
  const fmt = (m: bigint) => formatMoney(m, currency);
  const applied: AppliedRule[] = [];
  const errors: ValidationIssue[] = [];

  interface Draft {
    cap: bigint;
    minimum: bigint;
    fixed: bigint | null;
    excluded: boolean;
    priority: number;
    weight: bigint | null;
  }

  const drafts = new Map<string, Draft>();
  request.obligations.forEach((o) => {
    const d: Draft = {
      cap: o.outstandingMinor,
      minimum: 0n,
      fixed: null,
      excluded: o.excluded === true,
      priority: o.priority ?? UNPRIORITISED,
      weight: o.weight !== undefined ? unwrapWeight(o.weight) : null,
    };
    const add = (kind: AppliedRule["kind"], description: string) => applied.push({ obligationId: o.id, kind, description, source: "obligation" });
    if (o.maxMinor !== undefined) {
      d.cap = minBig(d.cap, o.maxMinor);
      add("cap", `maximum allocation ${fmt(o.maxMinor)}`);
    }
    if (o.minMinor !== undefined && o.minMinor > 0n) {
      d.minimum = o.minMinor;
      add("minimum", `minimum allocation ${fmt(o.minMinor)}`);
    }
    if (o.fixedMinor !== undefined) {
      d.fixed = o.fixedMinor;
      add("fixed", `fixed allocation ${fmt(o.fixedMinor)}`);
    }
    if (o.excluded) add("exclude", "excluded from this allocation");
    if (o.priority !== undefined) add("priority", `priority ${o.priority}`);
    if (o.weight !== undefined) add("weight", `weight ${o.weight}`);
    drafts.set(o.id, d);
  });

  (request.rules ?? []).forEach((rule, i) => {
    const d = drafts.get(rule.obligationId);
    if (!d) return; // reported by validateRequest
    const add = (description: string) =>
      applied.push({ obligationId: rule.obligationId, kind: rule.kind, description, source: "request", label: rule.label });
    switch (rule.kind) {
      case "cap":
        d.cap = minBig(d.cap, rule.maxMinor);
        add(`maximum allocation ${fmt(rule.maxMinor)}`);
        break;
      case "minimum":
        d.minimum = maxBig(d.minimum, rule.minMinor);
        add(`minimum allocation ${fmt(rule.minMinor)}`);
        break;
      case "fixed":
        if (d.fixed !== null && d.fixed !== rule.amountMinor) {
          errors.push({ path: `rules[${i}]`, message: `conflicting fixed amounts for "${rule.obligationId}": ${fmt(d.fixed)} and ${fmt(rule.amountMinor)}` });
        }
        d.fixed = rule.amountMinor;
        add(`fixed allocation ${fmt(rule.amountMinor)}`);
        break;
      case "exclude":
        d.excluded = true;
        add("excluded from this allocation");
        break;
      case "priority":
        d.priority = rule.priority;
        add(`priority ${rule.priority}`);
        break;
      case "weight":
        d.weight = unwrapWeight(rule.weight);
        add(`weight ${rule.weight}`);
        break;
    }
  });

  const effective = request.obligations.map((obligation, index): EffectiveObligation => {
    const d = drafts.get(obligation.id)!;
    const capacity = d.excluded ? 0n : d.cap;
    const at = `obligations[${index}]`;
    const name = `"${obligation.id}"`;
    if (d.excluded && (d.fixed !== null || d.minimum > 0n)) {
      errors.push({ path: at, message: `${name} is excluded but also has a fixed or minimum allocation` });
    } else if (d.fixed !== null && d.minimum > 0n) {
      errors.push({ path: at, message: `${name} has both a fixed and a minimum allocation; use one` });
    } else if (d.fixed !== null && d.fixed > capacity) {
      errors.push({ path: at, message: `${name} fixed allocation ${fmt(d.fixed)} exceeds its allocatable capacity ${fmt(capacity)}` });
    } else if (d.minimum > capacity) {
      errors.push({ path: at, message: `${name} minimum allocation ${fmt(d.minimum)} exceeds its allocatable capacity ${fmt(capacity)}` });
    }
    return { obligation, index, capacity, minimum: d.minimum, fixed: d.fixed, excluded: d.excluded, priority: d.priority, weight: d.weight };
  });

  return { effective, applied, errors };
}

function unwrapWeight(text: string): bigint | null {
  const w = parseWeight(text);
  return w.ok ? w.value : null;
}
