import type { ValidationIssue } from "../domain";
import { wholeFraction, type Fraction } from "../money/fraction";
import { UNPRIORITISED } from "../rules/resolve";
import { formatWeight } from "../money/weight";
import { formatMoney } from "../money/money";
import { compareIds, type ApportionedShare } from "../allocation/apportion";
import { weightedSplit, type AllocationStrategy, type Participant, type StrategyContext } from "./types";

const LARGEST_REMAINDER = "Largest remainder: floor every share, then give leftover minor units to the largest fractional remainders.";

const requireWeights = (ctx: StrategyContext, strategyName: string): ValidationIssue[] =>
  ctx.participants
    .filter((p) => p.weight === null)
    .map((p) => ({ path: `obligation "${p.id}".weight`, message: `${strategyName} allocation requires a weight for every participating obligation` }));

/** Weights between 0 and 100 that don't total 100 are usually a data-entry slip; flag it, then normalise. */
const percentageWarnings = (ctx: StrategyContext): string[] => {
  const weights = ctx.participants.map((p) => p.weight).filter((w): w is bigint => w !== null);
  if (weights.length === 0) return [];
  const hundred = 100n * 10n ** 9n;
  const total = weights.reduce((a, b) => a + b, 0n);
  const looksLikePercent = weights.every((w) => w <= hundred) && total > hundred / 2n && total < hundred * 2n;
  if (!looksLikePercent || total === hundred) return [];
  return [`Weights total ${formatWeight(total)}, not 100. They are treated as relative weights and normalised, not as absolute percentages.`];
};

export const proportional: AllocationStrategy = {
  id: "proportional",
  version: "2.0.0",
  name: "Proportional",
  summary: "Pro rata by each obligation's balance. The default for applying a partial payment across open invoices.",
  residualHandling: LARGEST_REMAINDER,
  validate(ctx) {
    if (ctx.proportionalBasis !== "original") return [];
    return ctx.participants
      .filter((p) => p.original === undefined)
      .map((p) => ({ path: `obligation "${p.id}".original`, message: "proportional-by-original requires an original amount on every participating obligation" }));
  },
  warnings: () => [],
  distribute(pool, ctx) {
    const byOriginal = ctx.proportionalBasis === "original";
    return weightedSplit(pool, ctx.participants, (p) => (byOriginal ? (p.original ?? 0n) : p.outstanding), byOriginal ? "original amount" : "outstanding balance");
  },
};

export const weighted: AllocationStrategy = {
  id: "weighted",
  version: "2.0.0",
  name: "Weighted",
  summary: "Split by explicit weights or percentages, such as a revenue share or partner split.",
  residualHandling: LARGEST_REMAINDER,
  validate: (ctx) => requireWeights(ctx, "Weighted"),
  warnings: percentageWarnings,
  distribute: (pool, ctx) => weightedSplit(pool, ctx.participants, (p) => p.weight ?? 0n, "weight"),
};

export const equal: AllocationStrategy = {
  id: "equal",
  version: "2.0.0",
  name: "Equal",
  summary: "Every participant gets the same share. Anything a capped participant can't take is re-split among the others.",
  residualHandling: LARGEST_REMAINDER + " Remainders are equal, so ties go by priority and then ID.",
  validate: () => [],
  warnings: () => [],
  distribute: (pool, ctx) => weightedSplit(pool, ctx.participants, () => 1n, "an equal split"),
};

export const fixedRemainder: AllocationStrategy = {
  id: "fixed-remainder",
  version: "2.0.0",
  name: "Fixed + remaining",
  summary: "Fixed amounts (a platform fee, a processor fee) come off the top; what's left is split by weight, or by balance if no weights are given.",
  residualHandling: LARGEST_REMAINDER,
  validate(ctx) {
    const issues: ValidationIssue[] = [];
    if (ctx.fixedCount === 0) issues.push({ path: "obligations", message: "Fixed + remaining allocation requires at least one obligation with a fixed amount" });
    const someWeighted = ctx.participants.some((p) => p.weight !== null);
    if (someWeighted) issues.push(...requireWeights(ctx, "Fixed + remaining (weighted remainder)"));
    return issues;
  },
  warnings: percentageWarnings,
  distribute(pool, ctx) {
    const useWeights = ctx.participants.length > 0 && ctx.participants.every((p) => p.weight !== null);
    return useWeights
      ? weightedSplit(pool, ctx.participants, (p) => p.weight ?? 0n, "weight", ["Remainder split by weight."])
      : weightedSplit(pool, ctx.participants, (p) => p.outstanding, "outstanding balance", ["Remainder split by outstanding balance (no weights supplied)."]);
  },
};

/** Priority order: lowest priority number, then earliest due date (undated last), then ID. */
export const comparePriority = (a: Participant, b: Participant) =>
  a.priority - b.priority ||
  (a.dueDate === b.dueDate ? 0 : a.dueDate === undefined ? 1 : b.dueDate === undefined ? -1 : a.dueDate < b.dueDate ? -1 : 1) ||
  compareIds(a.id, b.id);

export const priority: AllocationStrategy = {
  id: "priority",
  version: "2.0.0",
  name: "Priority / oldest first",
  summary: "Pays obligations in full, one at a time, in priority order (then oldest due date, then ID) until the amount runs out.",
  residualHandling: "None needed. Every allocation is a whole balance or the whole remaining amount, so nothing is rounded.",
  validate: () => [],
  warnings: () => [],
  distribute(pool, ctx) {
    const ordered = [...ctx.participants].sort(comparePriority);
    const shares = new Map<string, ApportionedShare>();
    const notes: string[] = [];
    const lineNotes = new Map<string, string[]>();
    let remaining = pool;
    ordered.forEach((p, i) => {
      const due = p.dueDate ? `, due ${p.dueDate}` : "";
      const rank = p.priority === UNPRIORITISED ? "no priority" : `priority ${p.priority}`;
      lineNotes.set(p.id, [`Position ${i + 1} of ${ordered.length} in payment order (${rank}${due})`]);
      const take = remaining < p.capacity ? remaining : p.capacity;
      remaining -= take;
      shares.set(p.id, { raw: wholeFraction(take), base: take, adjustment: 0n, allocated: take, capped: take === p.capacity && take > 0n });
      if (take > 0n) {
        notes.push(`#${i + 1} ${p.id}: applied ${formatMoney(take, ctx.currency)}${take === p.capacity ? " (fully satisfied)" : " (partially satisfied; amount exhausted)"}`);
      }
    });
    return { shares, basisShares: new Map<string, Fraction>(), basisLabel: "payment order", lineNotes, rounds: [], residual: 0n, adjustments: [], unallocated: remaining, notes };
  },
};
