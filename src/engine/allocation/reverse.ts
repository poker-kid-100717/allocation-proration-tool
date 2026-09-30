import {
  ENGINE_VERSION,
  type AllocationRequest,
  type AllocationResult,
  type CalculationStep,
  type EngineResult,
  type InvariantCheck,
  type ReversalLine,
  type ReversalRequest,
  type ReversalResult,
} from "../domain";
import { getCurrency } from "../money/currency";
import { formatFraction, wholeFraction } from "../money/fraction";
import { formatMoney, sumMinor } from "../money/money";
import { resolveRules } from "../rules/resolve";
import { comparePriority } from "../strategies/strategies";
import { apportion, RESIDUAL_TIE_BREAK, type ApportionedShare } from "./apportion";
import { fingerprintRequest, InvariantViolation } from "./allocate";

export const REVERSAL_METHOD_VERSION = "1.0.0";

export const REVERSAL_METHODS = {
  proportional: {
    name: "Proportional reversal",
    summary: "Each line gives back the same fraction of what it still holds, so the allocation mix is preserved after the refund.",
  },
  "reverse-priority": {
    name: "Reverse priority (last applied, first reversed)",
    summary: "Unwinds lines in the opposite of payment order: lowest priority and newest due date first, so the oldest debts stay paid.",
  },
} as const;

/**
 * Computes how a refund, chargeback or clawback unwinds an earlier allocation.
 *
 * The original allocation is never modified. The result is a new calculation
 * that points at the original through its input fingerprint and accounts for
 * any earlier reversals, so a series of partial refunds can never reverse more
 * than was allocated to any line.
 */
export function reverseAllocation(
  original: { readonly request: AllocationRequest; readonly result: AllocationResult },
  reversal: ReversalRequest,
  prior: readonly ReversalResult[] = [],
): EngineResult<ReversalResult> {
  const { request, result } = original;
  const { currency } = result;
  const fmt = (m: bigint) => formatMoney(m, currency);

  if (fingerprintRequest(request) !== result.inputFingerprint) {
    return { ok: false, errors: [{ path: "original", message: "the original result does not match its request; it cannot be reversed reliably" }] };
  }
  if (!Object.hasOwn(REVERSAL_METHODS, reversal.method)) {
    return { ok: false, errors: [{ path: "method", message: `"${String(reversal.method)}" is not a reversal method` }] };
  }
  if (reversal.amountMinor <= 0n) {
    return { ok: false, errors: [{ path: "amount", message: "reversal amount must be greater than zero" }] };
  }
  const foreign = prior.find((p) => p.reversesFingerprint !== result.inputFingerprint);
  if (foreign) return { ok: false, errors: [{ path: "prior", message: "a prior reversal references a different allocation" }] };

  const previously = new Map<string, bigint>();
  for (const p of prior) for (const l of p.lines) previously.set(l.obligationId, (previously.get(l.obligationId) ?? 0n) + l.reversedMinor);

  const holdings = result.lines.map((l) => ({ line: l, prior: previously.get(l.obligationId) ?? 0n, net: l.allocatedMinor - (previously.get(l.obligationId) ?? 0n) }));
  const netTotal = sumMinor(holdings.map((h) => h.net));
  const priorTotal = sumMinor(holdings.map((h) => h.prior));
  if (reversal.amountMinor > netTotal) {
    return {
      ok: false,
      errors: [
        {
          path: "amount",
          message: `reversal of ${fmt(reversal.amountMinor)} exceeds the ${fmt(netTotal)} still allocated (${fmt(result.totals.allocatedMinor)} allocated, ${fmt(priorTotal)} already reversed)`,
        },
      ],
    };
  }

  const steps: CalculationStep[] = [
    {
      stage: "validate",
      message: `Reversing ${fmt(reversal.amountMinor)} of allocation ${result.inputFingerprint}; ${fmt(netTotal)} still allocated after ${prior.length} prior reversal(s).`,
    },
  ];

  let shares: Map<string, ApportionedShare>;
  let residual = 0n;
  let adjustments: ReversalResult["rounding"]["adjustments"] = [];

  if (reversal.method === "proportional") {
    const split = apportion(
      reversal.amountMinor,
      holdings.map((h) => ({ id: h.line.obligationId, weight: h.net, capacity: h.net, priority: 0 })),
    );
    shares = new Map(split.shares);
    residual = split.residual;
    adjustments = split.adjustments;
    steps.push({ stage: "strategy", message: `Split ${fmt(reversal.amountMinor)} in proportion to each line's net allocation (${fmt(netTotal)} in total).` });
  } else {
    const { effective } = resolveRules(request);
    const order = effective
      .map((e) => ({ id: e.obligation.id, priority: e.priority, dueDate: e.obligation.dueDate, outstanding: 0n, original: undefined, capacity: 0n, weight: null }))
      .sort(comparePriority)
      .reverse();
    const net = new Map(holdings.map((h) => [h.line.obligationId, h.net]));
    shares = new Map();
    let remaining = reversal.amountMinor;
    for (const p of order) {
      const available = net.get(p.id) ?? 0n;
      const take = remaining < available ? remaining : available;
      remaining -= take;
      shares.set(p.id, { raw: wholeFraction(take), base: take, adjustment: 0n, allocated: take, capped: take === available && take > 0n });
      if (take > 0n) steps.push({ stage: "strategy", message: `${p.id}: reversed ${fmt(take)}${take === available ? " (fully unwound)" : ""}` });
    }
  }

  if (residual > 0n) {
    steps.push({ stage: "rounding", message: `Residual of ${fmt(residual)} assigned by largest remainder to ${adjustments.map((a) => a.obligationId).join(", ")}.` });
  }

  const lines: ReversalLine[] = holdings.map((h) => {
    const s = shares.get(h.line.obligationId)!;
    const netAfter = h.net - s.allocated;
    const explanation = [
      `Originally allocated: ${fmt(h.line.allocatedMinor)}`,
      ...(h.prior > 0n ? [`Previously reversed: ${fmt(h.prior)}`] : []),
      ...(reversal.method === "proportional"
        ? [
            `Raw reversal: ${getCurrency(currency).symbol}${formatFraction(s.raw, currency, 4)}`,
            `Rounded base (floor): ${fmt(s.base)}`,
            `Residual adjustment: ${s.adjustment > 0n ? formatMoney(s.adjustment, currency, { signed: true }) : fmt(0n)}`,
          ]
        : []),
      `Reversed: ${fmt(s.allocated)}`,
      `Net allocated after reversal: ${fmt(netAfter)}`,
    ];
    return {
      obligationId: h.line.obligationId,
      description: h.line.description,
      originallyAllocatedMinor: h.line.allocatedMinor,
      previouslyReversedMinor: h.prior,
      raw: s.raw,
      baseMinor: s.base,
      residualAdjustmentMinor: s.adjustment,
      reversedMinor: s.allocated,
      netAllocatedMinor: netAfter,
      explanation,
    };
  });

  const reversedMinor = sumMinor(lines.map((l) => l.reversedMinor));
  const invariants: InvariantCheck[] = [
    { name: "Conservation of money", holds: reversedMinor === reversal.amountMinor, detail: `reversed ${fmt(reversedMinor)} vs requested ${fmt(reversal.amountMinor)}` },
    { name: "No over-reversal", holds: lines.every((l) => l.netAllocatedMinor >= 0n), detail: "no line gives back more than it still holds" },
    { name: "No negative reversals", holds: lines.every((l) => l.reversedMinor >= 0n), detail: "every reversal ≥ 0" },
    {
      name: "Rounding bounded",
      holds: lines.every((l) => {
        const diff = l.reversedMinor * l.raw.den - l.raw.num;
        return diff < l.raw.den && -diff < l.raw.den;
      }),
      detail: "every reversal is within one minor unit of its exact share",
    },
  ];
  const failures = invariants.filter((i) => !i.holds);
  if (failures.length > 0) throw new InvariantViolation(failures);
  steps.push({ stage: "invariants", message: `All ${invariants.length} invariants hold; reversed total equals ${fmt(reversal.amountMinor)}.` });

  return {
    ok: true,
    value: {
      engineVersion: ENGINE_VERSION,
      method: reversal.method,
      methodVersion: REVERSAL_METHOD_VERSION,
      currency,
      amountMinor: reversal.amountMinor,
      reason: reversal.reason,
      reversesFingerprint: result.inputFingerprint,
      lines,
      totals: {
        originallyAllocatedMinor: result.totals.allocatedMinor,
        previouslyReversedMinor: priorTotal,
        reversedMinor,
        netAllocatedMinor: netTotal - reversedMinor,
      },
      rounding: { method: "largest-remainder", tieBreak: RESIDUAL_TIE_BREAK, residualMinor: residual, adjustments },
      steps,
      invariants,
    },
  };
}
