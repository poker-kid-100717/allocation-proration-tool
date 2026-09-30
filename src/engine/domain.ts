import type { CurrencyCode } from "./money/currency";
import type { Fraction } from "./money/fraction";

/**
 * Bumped whenever a change could alter the output for an existing input.
 * Stored on every calculation so historical results can be reproduced
 * against the engine version that produced them.
 */
export const ENGINE_VERSION = "2.0.0";

export type StrategyId = "proportional" | "weighted" | "equal" | "priority" | "fixed-remainder";

/** Something an amount can be applied to: an invoice, a payee, a transaction. */
export interface Obligation {
  readonly id: string;
  readonly description?: string;
  /** Original face amount. Informational, and the basis for proportional-by-original. */
  readonly originalMinor?: bigint;
  /** Balance still owed; nothing may be allocated beyond it. */
  readonly outstandingMinor: bigint;
  /** Relative weight as a decimal string ("42", "33.5"). Normalised, not required to total 100. */
  readonly weight?: string;
  /** Lower numbers are served first by the priority strategy and win residual ties. */
  readonly priority?: number;
  /** ISO date (YYYY-MM-DD); orders equal-priority obligations oldest first. */
  readonly dueDate?: string;
  readonly maxMinor?: bigint;
  readonly minMinor?: bigint;
  readonly fixedMinor?: bigint;
  readonly excluded?: boolean;
}

/**
 * Request-level rules. They overlay the constraints declared on individual
 * obligations: caps take the lowest value, minimums the highest, and
 * priority/weight rules replace the obligation's own value.
 */
export type AllocationRule =
  | { readonly kind: "cap"; readonly obligationId: string; readonly maxMinor: bigint; readonly label?: string }
  | { readonly kind: "minimum"; readonly obligationId: string; readonly minMinor: bigint; readonly label?: string }
  | { readonly kind: "fixed"; readonly obligationId: string; readonly amountMinor: bigint; readonly label?: string }
  | { readonly kind: "exclude"; readonly obligationId: string; readonly label?: string }
  | { readonly kind: "priority"; readonly obligationId: string; readonly priority: number; readonly label?: string }
  | { readonly kind: "weight"; readonly obligationId: string; readonly weight: string; readonly label?: string };

export type RuleKind = AllocationRule["kind"];

export type ProportionalBasis = "outstanding" | "original";

export interface AllocationRequest {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
  readonly strategy: StrategyId;
  readonly obligations: readonly Obligation[];
  readonly rules?: readonly AllocationRule[];
  readonly options?: { readonly proportionalBasis?: ProportionalBasis };
}

export interface ValidationIssue {
  /** Location in the request, e.g. "obligations[2].outstanding". */
  readonly path: string;
  readonly message: string;
}

export type EngineResult<T> = { ok: true; value: T } | { ok: false; errors: ValidationIssue[] };

/** A constraint in effect for an obligation, with where it came from. */
export interface AppliedRule {
  readonly obligationId: string;
  readonly kind: RuleKind;
  readonly description: string;
  readonly source: "obligation" | "request";
  readonly label?: string;
}

/** One unit of residual that rounding assigned to a line, and why that line. */
export interface RoundingAdjustment {
  readonly obligationId: string;
  readonly adjustmentMinor: bigint;
  /** 1-based position in the residual ranking. */
  readonly rank: number;
  /** Fractional remainder (in minor units) that earned the residual unit. */
  readonly remainder: Fraction;
}

export interface CalculationStep {
  readonly stage: "validate" | "rules" | "fixed" | "minimum" | "strategy" | "rounding" | "invariants";
  readonly message: string;
}

export interface AllocationLine {
  readonly obligationId: string;
  readonly description: string;
  readonly outstandingMinor: bigint;
  /** Most this line could receive: outstanding, lowered by any caps; 0 when excluded. */
  readonly capacityMinor: bigint;
  /** This line's share of the strategy's basis (outstanding, weight, …) before caps. */
  readonly basisShare: Fraction | null;
  readonly fixedMinor: bigint;
  readonly minimumMinor: bigint;
  /** Exact unrounded amount (fixed + minimum + strategy share), in minor units. */
  readonly raw: Fraction;
  /** Amount before residual distribution. */
  readonly baseMinor: bigint;
  readonly residualAdjustmentMinor: bigint;
  readonly allocatedMinor: bigint;
  /** outstanding − allocated. */
  readonly remainingMinor: bigint;
  readonly capped: boolean;
  readonly excluded: boolean;
  readonly explanation: readonly string[];
}

export interface InvariantCheck {
  readonly name: string;
  readonly holds: boolean;
  readonly detail: string;
}

export interface RoundingSummary {
  readonly method: "largest-remainder";
  readonly tieBreak: readonly string[];
  /** Minor units left over after flooring every raw share, then handed out one each. */
  readonly residualMinor: bigint;
  readonly adjustments: readonly RoundingAdjustment[];
}

export interface AllocationTotals {
  readonly requestedMinor: bigint;
  readonly allocatedMinor: bigint;
  /** Amount that could not be applied because every obligation reached capacity. */
  readonly unallocatedMinor: bigint;
  readonly outstandingMinor: bigint;
  readonly remainingOutstandingMinor: bigint;
  /** Most that could be allocated: fixed amounts plus every other line's capacity. */
  readonly capacityMinor: bigint;
}

export interface AllocationResult {
  readonly engineVersion: string;
  readonly strategy: { readonly id: StrategyId; readonly version: string; readonly name: string };
  readonly currency: CurrencyCode;
  readonly amountMinor: bigint;
  readonly lines: readonly AllocationLine[];
  readonly totals: AllocationTotals;
  readonly rounding: RoundingSummary;
  readonly appliedRules: readonly AppliedRule[];
  readonly steps: readonly CalculationStep[];
  readonly warnings: readonly string[];
  readonly invariants: readonly InvariantCheck[];
  /** Hash of the canonical request; identical inputs always share it. */
  readonly inputFingerprint: string;
}

export type ReversalMethod = "proportional" | "reverse-priority";

export interface ReversalRequest {
  readonly amountMinor: bigint;
  readonly method: ReversalMethod;
  readonly reason?: string;
}

export interface ReversalLine {
  readonly obligationId: string;
  readonly description: string;
  readonly originallyAllocatedMinor: bigint;
  readonly previouslyReversedMinor: bigint;
  readonly raw: Fraction;
  readonly baseMinor: bigint;
  readonly residualAdjustmentMinor: bigint;
  readonly reversedMinor: bigint;
  /** originallyAllocated − previouslyReversed − reversed. */
  readonly netAllocatedMinor: bigint;
  readonly explanation: readonly string[];
}

export interface ReversalResult {
  readonly engineVersion: string;
  readonly method: ReversalMethod;
  readonly methodVersion: string;
  readonly currency: CurrencyCode;
  readonly amountMinor: bigint;
  readonly reason?: string;
  /** Fingerprint of the allocation being reversed. */
  readonly reversesFingerprint: string;
  readonly lines: readonly ReversalLine[];
  readonly totals: {
    readonly originallyAllocatedMinor: bigint;
    readonly previouslyReversedMinor: bigint;
    readonly reversedMinor: bigint;
    readonly netAllocatedMinor: bigint;
  };
  readonly rounding: RoundingSummary;
  readonly steps: readonly CalculationStep[];
  readonly invariants: readonly InvariantCheck[];
}
