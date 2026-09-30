import type { ProportionalBasis, StrategyId, ValidationIssue } from "../domain";
import type { CurrencyCode } from "../money/currency";
import { fraction, type Fraction } from "../money/fraction";
import { apportion, type ApportionedShare, type Apportionment } from "../allocation/apportion";

/** An obligation as a strategy sees it: what it may still receive after fixed and minimum stages. */
export interface Participant {
  readonly id: string;
  readonly outstanding: bigint;
  readonly original: bigint | undefined;
  /** Remaining room after caps and any minimum already allocated. */
  readonly capacity: bigint;
  /** Scaled integer weight, or null when none was supplied. */
  readonly weight: bigint | null;
  readonly priority: number;
  readonly dueDate: string | undefined;
}

export interface StrategyContext {
  readonly currency: CurrencyCode;
  readonly proportionalBasis: ProportionalBasis;
  /** Obligations that will take part in the strategy stage (not excluded, not fixed). */
  readonly participants: readonly Participant[];
  /** Number of obligations settled by a fixed allocation before the strategy runs. */
  readonly fixedCount: number;
}

export interface StrategyDistribution extends Omit<Apportionment, "shares"> {
  readonly shares: ReadonlyMap<string, ApportionedShare>;
  /** Each participant's share of the basis before caps (e.g. 42% of total outstanding). */
  readonly basisShares: ReadonlyMap<string, Fraction>;
  readonly basisLabel: string;
  readonly notes: readonly string[];
  /** Strategy-specific explanation lines for individual obligations. */
  readonly lineNotes?: ReadonlyMap<string, readonly string[]>;
}

/**
 * The extension point. A strategy decides how the pool left after fixed and
 * minimum allocations is split; the engine owns validation, rules, the fixed
 * and minimum stages, invariant checks and the audit record. Adding a strategy
 * means implementing this interface and registering it, nothing else.
 */
export interface AllocationStrategy {
  readonly id: StrategyId;
  /** Bumped when the strategy's output for a given input could change. */
  readonly version: string;
  readonly name: string;
  readonly summary: string;
  readonly residualHandling: string;
  validate(ctx: StrategyContext): ValidationIssue[];
  warnings(ctx: StrategyContext): string[];
  distribute(pool: bigint, ctx: StrategyContext): StrategyDistribution;
}

/** Shared implementation for strategies that are "split by some weight, capped, largest remainder". */
export function weightedSplit(
  pool: bigint,
  participants: readonly Participant[],
  weightOf: (p: Participant) => bigint,
  basisLabel: string,
  notes: string[] = [],
): StrategyDistribution {
  const claimants = participants.map((p) => ({ id: p.id, weight: weightOf(p), capacity: p.capacity, priority: p.priority }));
  const totalWeight = claimants.reduce((sum, c) => sum + c.weight, 0n);
  const basisShares = new Map<string, Fraction>();
  if (totalWeight > 0n) for (const c of claimants) basisShares.set(c.id, fraction(c.weight, totalWeight));
  const result = apportion(pool, claimants);
  return { ...result, basisShares, basisLabel, notes };
}
