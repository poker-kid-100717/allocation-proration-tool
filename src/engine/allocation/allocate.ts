import {
  ENGINE_VERSION,
  type AllocationLine,
  type AllocationRequest,
  type AllocationResult,
  type CalculationStep,
  type EngineResult,
  type InvariantCheck,
} from "../domain";
import { formatFraction, formatPercent, wholeFraction, type Fraction } from "../money/fraction";
import { getCurrency } from "../money/currency";
import { formatMoney, sumMinor } from "../money/money";
import { resolveRules, type EffectiveObligation } from "../rules/resolve";
import { getStrategy } from "../strategies/registry";
import type { Participant, StrategyContext } from "../strategies/types";
import { validateRequest } from "../validation/validate";
import { RESIDUAL_TIE_BREAK } from "./apportion";
import { fingerprint } from "./fingerprint";

/** Thrown when a computed result breaks a financial invariant. Indicates an engine bug, never bad input. */
export class InvariantViolation extends Error {
  constructor(readonly failures: readonly InvariantCheck[]) {
    super(`Allocation invariant violated: ${failures.map((f) => `${f.name} (${f.detail})`).join("; ")}`);
    this.name = "InvariantViolation";
  }
}

const addWhole = (whole: bigint, f: Fraction): Fraction => ({ num: whole * f.den + f.num, den: f.den });

/**
 * Distributes `request.amountMinor` across the request's obligations.
 *
 * Pipeline: validate → resolve rules → fixed amounts → minimums → strategy →
 * residual rounding → invariant checks. The function is pure: the same request
 * always yields a deep-equal result, independent of obligation order, locale,
 * clock or platform. Invalid input returns every problem found; an internal
 * invariant failure throws rather than returning a wrong amount of money.
 */
export function allocate(request: AllocationRequest): EngineResult<AllocationResult> {
  const structural = validateRequest(request);
  if (structural.length > 0) return { ok: false, errors: structural };

  const { currency, amountMinor } = request;
  const fmt = (m: bigint) => formatMoney(m, currency);
  const strategy = getStrategy(request.strategy);
  const steps: CalculationStep[] = [];

  const { effective, applied, errors } = resolveRules(request);
  if (errors.length > 0) return { ok: false, errors };

  const fixedTotal = sumMinor(effective.map((e) => e.fixed ?? 0n));
  const minimumTotal = sumMinor(effective.map((e) => e.minimum));
  if (fixedTotal + minimumTotal > amountMinor) {
    return {
      ok: false,
      errors: [
        {
          path: "amount",
          message: `${fmt(amountMinor)} cannot cover the fixed (${fmt(fixedTotal)}) and minimum (${fmt(minimumTotal)}) allocations, which total ${fmt(fixedTotal + minimumTotal)}`,
        },
      ],
    };
  }

  const participants: Participant[] = effective
    .filter((e) => !e.excluded && e.fixed === null)
    .map((e) => ({
      id: e.obligation.id,
      outstanding: e.obligation.outstandingMinor,
      original: e.obligation.originalMinor,
      capacity: e.capacity - e.minimum,
      weight: e.weight,
      priority: e.priority,
      dueDate: e.obligation.dueDate,
    }));
  const ctx: StrategyContext = {
    currency,
    proportionalBasis: request.options?.proportionalBasis ?? "outstanding",
    participants,
    fixedCount: effective.filter((e) => e.fixed !== null).length,
  };
  const strategyErrors = strategy.validate(ctx);
  if (strategyErrors.length > 0) return { ok: false, errors: strategyErrors };
  const warnings = strategy.warnings(ctx);

  const excludedCount = effective.filter((e) => e.excluded).length;
  steps.push({
    stage: "validate",
    message: `Validated ${effective.length.toLocaleString("en-US")} obligation(s) in ${currency}; amount to allocate ${fmt(amountMinor)}.`,
  });
  steps.push({
    stage: "rules",
    message:
      applied.length === 0
        ? "No rules or constraints beyond outstanding balances."
        : `Resolved ${applied.length} rule(s)/constraint(s)${excludedCount ? `; ${excludedCount} obligation(s) excluded` : ""}. Each allocation is capped at min(outstanding, maximums).`,
  });
  if (fixedTotal > 0n || ctx.fixedCount > 0) {
    steps.push({ stage: "fixed", message: `Allocated fixed amounts totalling ${fmt(fixedTotal)} to ${ctx.fixedCount} obligation(s) before any split.` });
  }
  if (minimumTotal > 0n) {
    steps.push({ stage: "minimum", message: `Allocated minimum amounts totalling ${fmt(minimumTotal)}; their remaining capacity joins the split.` });
  }

  const pool = amountMinor - fixedTotal - minimumTotal;
  const dist = strategy.distribute(pool, ctx);

  steps.push({
    stage: "strategy",
    message: `${strategy.name} v${strategy.version}: distributing ${fmt(pool)} across ${participants.length.toLocaleString("en-US")} participant(s) by ${dist.basisLabel}.`,
  });
  for (const r of dist.rounds) {
    const names = r.capped.length <= 5 ? r.capped.join(", ") : `${r.capped.slice(0, 5).join(", ")} and ${r.capped.length - 5} more`;
    steps.push({
      stage: "strategy",
      message: `Round ${r.round}: splitting ${fmt(r.pool)}, ${r.capped.length} obligation(s) reached capacity (${names}) and receive exactly their capacity; the rest is re-split among the others.`,
    });
  }
  for (const note of dist.notes.slice(0, 25)) steps.push({ stage: "strategy", message: note });
  if (dist.notes.length > 25) steps.push({ stage: "strategy", message: `… ${dist.notes.length - 25} more.` });

  if (dist.residual > 0n) {
    const who = dist.adjustments.slice(0, 5).map((a) => a.obligationId).join(", ");
    steps.push({
      stage: "rounding",
      message: `Flooring left a residual of ${fmt(dist.residual)} (${dist.residual} minor unit(s)). One unit each went to the largest remainders: ${who}${dist.adjustments.length > 5 ? ` and ${dist.adjustments.length - 5} more` : ""}.`,
    });
  } else {
    steps.push({ stage: "rounding", message: "No residual: every share was already a whole number of minor units." });
  }

  const adjustmentRank = new Map(dist.adjustments.map((a) => [a.obligationId, a] as const));
  const lines = effective.map((e) => buildLine(e));

  function buildLine(e: EffectiveObligation): AllocationLine {
    const o = e.obligation;
    const base = {
      obligationId: o.id,
      description: o.description ?? "",
      outstandingMinor: o.outstandingMinor,
      capacityMinor: e.capacity,
      minimumMinor: e.minimum,
      excluded: e.excluded,
    };
    const explanation: string[] = [`Outstanding: ${fmt(o.outstandingMinor)}`];
    if (e.excluded) {
      explanation.push("Excluded by rule: receives nothing.", `Final: ${fmt(0n)}`);
      return { ...base, basisShare: null, fixedMinor: 0n, raw: wholeFraction(0n), baseMinor: 0n, residualAdjustmentMinor: 0n, allocatedMinor: 0n, remainingMinor: o.outstandingMinor, capped: false, explanation };
    }
    if (e.capacity < o.outstandingMinor) explanation.push(`Allocatable capacity after caps: ${fmt(e.capacity)}`);
    if (e.fixed !== null) {
      explanation.push(`Fixed allocation: ${fmt(e.fixed)}, taken before the split.`, `Final: ${fmt(e.fixed)}`, `Remaining balance: ${fmt(o.outstandingMinor - e.fixed)}`);
      return { ...base, basisShare: null, fixedMinor: e.fixed, raw: wholeFraction(e.fixed), baseMinor: e.fixed, residualAdjustmentMinor: 0n, allocatedMinor: e.fixed, remainingMinor: o.outstandingMinor - e.fixed, capped: false, explanation };
    }

    const share = dist.shares.get(o.id)!;
    const basisShare = dist.basisShares.get(o.id) ?? null;
    if (basisShare) explanation.push(`Share of ${dist.basisLabel}: ${formatPercent(basisShare, 2)}`);
    explanation.push(...(dist.lineNotes?.get(o.id) ?? []));
    if (e.minimum > 0n) explanation.push(`Minimum allocation: ${fmt(e.minimum)}, allocated before the split.`);

    const raw = addWhole(e.minimum, share.raw);
    const allocated = e.minimum + share.allocated;
    if (share.cappedInRound !== undefined) {
      explanation.push(`Proportional share met or exceeded capacity in round ${share.cappedInRound}, so it receives exactly its capacity; the surplus was re-split among the others.`);
    } else {
      explanation.push(`Raw allocation: ${getCurrency(currency).symbol}${formatFraction(raw, currency, 4)}`);
      explanation.push(`Rounded base (floor): ${fmt(e.minimum + share.base)}`);
      const adj = adjustmentRank.get(o.id);
      explanation.push(
        adj
          ? `Residual adjustment: ${formatMoney(adj.adjustmentMinor, currency, { signed: true })} (rank ${adj.rank} of ${dist.adjustments.length} by fractional remainder)`
          : `Residual adjustment: ${fmt(0n)}`,
      );
    }
    explanation.push(`Final: ${fmt(allocated)}`, `Remaining balance: ${fmt(o.outstandingMinor - allocated)}`);

    return {
      ...base,
      basisShare,
      fixedMinor: 0n,
      raw,
      baseMinor: e.minimum + share.base,
      residualAdjustmentMinor: share.adjustment,
      allocatedMinor: allocated,
      remainingMinor: o.outstandingMinor - allocated,
      capped: share.capped,
      explanation,
    };
  }

  const allocatedMinor = sumMinor(lines.map((l) => l.allocatedMinor));
  const outstandingMinor = sumMinor(lines.map((l) => l.outstandingMinor));
  // Most that could be allocated: a fixed line takes exactly its fixed amount, every other line up to its capacity.
  const capacityMinor = sumMinor(lines.map((l, i) => effective[i].fixed ?? l.capacityMinor));
  const totals = {
    requestedMinor: amountMinor,
    allocatedMinor,
    unallocatedMinor: amountMinor - allocatedMinor,
    outstandingMinor,
    remainingOutstandingMinor: outstandingMinor - allocatedMinor,
    capacityMinor,
  };

  if (totals.unallocatedMinor > 0n) {
    warnings.push(`${fmt(totals.unallocatedMinor)} could not be allocated: every eligible obligation reached its balance or cap. Treat it as unapplied (e.g. credit on account).`);
  }

  const invariants = checkInvariants(lines, effective, totals, amountMinor, fmt);
  const failures = invariants.filter((i) => !i.holds);
  if (failures.length > 0) throw new InvariantViolation(failures);
  steps.push({ stage: "invariants", message: `All ${invariants.length} invariants hold; allocated + unallocated = ${fmt(amountMinor)}.` });

  return {
    ok: true,
    value: {
      engineVersion: ENGINE_VERSION,
      strategy: { id: strategy.id, version: strategy.version, name: strategy.name },
      currency,
      amountMinor,
      lines,
      totals,
      rounding: {
        method: "largest-remainder",
        tieBreak: RESIDUAL_TIE_BREAK,
        residualMinor: dist.residual,
        adjustments: dist.adjustments,
      },
      appliedRules: applied,
      steps,
      warnings,
      invariants,
      inputFingerprint: fingerprintRequest(request),
    },
  };
}

/** Includes engine and strategy versions: the same inputs under a changed algorithm are a different calculation. */
export const fingerprintRequest = (request: AllocationRequest) =>
  fingerprint({ engine: ENGINE_VERSION, strategyVersion: getStrategy(request.strategy).version, request });

function checkInvariants(
  lines: readonly AllocationLine[],
  effective: readonly EffectiveObligation[],
  totals: AllocationResult["totals"],
  amount: bigint,
  fmt: (m: bigint) => string,
): InvariantCheck[] {
  const every = (pred: (l: AllocationLine, i: number) => boolean) => lines.every(pred);
  const conservation = totals.allocatedMinor + totals.unallocatedMinor === amount && totals.unallocatedMinor >= 0n;
  const fullyApplied = totals.unallocatedMinor === 0n || totals.allocatedMinor === totals.capacityMinor;
  return [
    {
      name: "Conservation of money",
      holds: conservation,
      detail: `allocated ${fmt(totals.allocatedMinor)} + unallocated ${fmt(totals.unallocatedMinor)} = ${fmt(totals.allocatedMinor + totals.unallocatedMinor)} vs amount ${fmt(amount)}`,
    },
    {
      name: "Full application",
      holds: fullyApplied,
      detail: totals.unallocatedMinor === 0n ? "the entire amount was allocated" : "amount left over only because every obligation is at capacity",
    },
    { name: "No negative allocations", holds: every((l) => l.allocatedMinor >= 0n), detail: "every allocation ≥ 0" },
    {
      name: "Caps respected",
      holds: every((l) => l.allocatedMinor <= l.capacityMinor && l.allocatedMinor <= l.outstandingMinor),
      detail: "every allocation ≤ min(outstanding, maximum)",
    },
    { name: "Fixed amounts honoured", holds: every((l, i) => effective[i].fixed === null || l.allocatedMinor === effective[i].fixed), detail: "fixed obligations receive exactly their amount" },
    { name: "Minimums honoured", holds: every((l, i) => l.allocatedMinor >= effective[i].minimum), detail: "every allocation ≥ its minimum" },
    { name: "Exclusions honoured", holds: every((l) => !l.excluded || l.allocatedMinor === 0n), detail: "excluded obligations receive nothing" },
    {
      name: "Rounding bounded",
      holds: every((l) => {
        const diff = l.allocatedMinor * l.raw.den - l.raw.num;
        return diff < l.raw.den && -diff < l.raw.den;
      }),
      detail: "every allocation is within one minor unit of its exact share",
    },
  ];
}
