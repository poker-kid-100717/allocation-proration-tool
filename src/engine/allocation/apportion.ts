import type { RoundingAdjustment } from "../domain";
import { fraction, wholeFraction, type Fraction } from "../money/fraction";

/** A participant in a weighted split: who, how much weight, and the most they may receive. */
export interface Claimant {
  readonly id: string;
  /** Non-negative integer weight; only its ratio to the other weights matters. */
  readonly weight: bigint;
  /** Non-negative integer ceiling in minor units. */
  readonly capacity: bigint;
  /** Lower wins residual ties. */
  readonly priority: number;
}

export interface ApportionedShare {
  readonly raw: Fraction;
  readonly base: bigint;
  readonly adjustment: bigint;
  readonly allocated: bigint;
  readonly capped: boolean;
  /** Redistribution round in which the claimant hit its ceiling. */
  readonly cappedInRound?: number;
}

export interface CapRound {
  readonly round: number;
  readonly pool: bigint;
  readonly totalWeight: bigint;
  readonly capped: readonly string[];
}

export interface Apportionment {
  readonly shares: ReadonlyMap<string, ApportionedShare>;
  readonly rounds: readonly CapRound[];
  /** Minor units that flooring left over and that were handed out one per claimant. */
  readonly residual: bigint;
  readonly adjustments: readonly RoundingAdjustment[];
  /** Part of the pool no claimant could absorb because every one reached capacity. */
  readonly unallocated: bigint;
}

export const RESIDUAL_TIE_BREAK = [
  "largest fractional remainder first",
  "then lowest priority number",
  "then obligation ID in ascending code-unit order",
] as const;

/** Code-unit comparison: locale-independent, so every runtime orders IDs identically. */
export const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Splits `pool` minor units across claimants in proportion to their weights,
 * never exceeding a claimant's capacity, and returns integers that sum exactly
 * to the pool (or to total capacity, if that is smaller).
 *
 * 1. Capped redistribution. A claimant whose proportional share meets or exceeds
 *    its capacity receives exactly its capacity, and the rest of the pool is
 *    re-split across the remaining claimants by the same rule, until nobody's
 *    share exceeds their capacity. Claimants are visited in ascending
 *    capacity/weight order: capping one can only raise everybody else's share,
 *    so once the lowest-ratio claimant fits, every other claimant fits too. That
 *    makes the loop O(n log n) instead of O(n²).
 * 2. Largest remainder (Hamilton's method). Every uncapped share is floored to a
 *    whole minor unit. The leftover units (always fewer than the number of
 *    claimants) go one each to the claimants with the largest fractional
 *    remainders, ties broken by priority and then by ID. A share below capacity
 *    that has a remainder is at least one unit below capacity, so the extra unit
 *    can never break a cap.
 *
 * Every comparison is exact bigint cross-multiplication; nothing is a float.
 */
export function apportion(pool: bigint, claimants: readonly Claimant[]): Apportionment {
  if (pool < 0n) throw new RangeError("Pool must be non-negative.");
  const shares = new Map<string, ApportionedShare>();
  const zero = { raw: wholeFraction(0n), base: 0n, adjustment: 0n, allocated: 0n, capped: false } as const;

  const active: Claimant[] = [];
  for (const c of claimants) {
    if (c.weight < 0n || c.capacity < 0n) throw new RangeError(`Claimant ${c.id} has a negative weight or capacity.`);
    if (c.weight > 0n && c.capacity > 0n) active.push(c);
    else shares.set(c.id, { ...zero, capped: c.capacity === 0n && c.weight > 0n });
  }

  // Ascending capacity/weight: the claimants most likely to be capped come first.
  active.sort((a, b) => {
    const l = a.capacity * b.weight;
    const r = b.capacity * a.weight;
    return l < r ? -1 : l > r ? 1 : compareIds(a.id, b.id);
  });

  let remaining = pool;
  let totalWeight = active.reduce((sum, c) => sum + c.weight, 0n);
  let next = 0;
  const rounds: CapRound[] = [];

  while (next < active.length && remaining > 0n) {
    // Claimant i is capped when remaining·wᵢ/W ≥ capᵢ, i.e. capᵢ·W ≤ remaining·wᵢ.
    const roundPool = remaining;
    const roundWeight = totalWeight;
    const capped: string[] = [];
    while (next < active.length && active[next].capacity * roundWeight <= roundPool * active[next].weight) {
      const c = active[next++];
      shares.set(c.id, { raw: wholeFraction(c.capacity), base: c.capacity, adjustment: 0n, allocated: c.capacity, capped: true, cappedInRound: rounds.length + 1 });
      remaining -= c.capacity;
      totalWeight -= c.weight;
      capped.push(c.id);
    }
    if (capped.length === 0) break;
    rounds.push({ round: rounds.length + 1, pool: roundPool, totalWeight: roundWeight, capped });
  }

  const uncapped = active.slice(next);
  if (uncapped.length === 0 || remaining === 0n) {
    for (const c of uncapped) shares.set(c.id, zero);
    return { shares, rounds, residual: 0n, adjustments: [], unallocated: remaining };
  }

  const floored = uncapped.map((c) => {
    const numerator = remaining * c.weight;
    return { c, base: numerator / totalWeight, remainder: numerator % totalWeight, numerator };
  });
  const residual = remaining - floored.reduce((sum, f) => sum + f.base, 0n);

  const ranked = [...floored].sort(
    (a, b) =>
      (a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : 0) ||
      a.c.priority - b.c.priority ||
      compareIds(a.c.id, b.c.id),
  );
  const winners = new Map<string, number>();
  for (let i = 0; BigInt(i) < residual; i++) winners.set(ranked[i].c.id, i + 1);

  const adjustments: RoundingAdjustment[] = [];
  for (const f of floored) {
    const rank = winners.get(f.c.id);
    const adjustment = rank === undefined ? 0n : 1n;
    if (rank !== undefined) {
      adjustments.push({ obligationId: f.c.id, adjustmentMinor: 1n, rank, remainder: fraction(f.remainder, totalWeight) });
    }
    shares.set(f.c.id, {
      raw: fraction(f.numerator, totalWeight),
      base: f.base,
      adjustment,
      allocated: f.base + adjustment,
      capped: false,
    });
  }
  adjustments.sort((a, b) => a.rank - b.rank);

  return { shares, rounds, residual, adjustments, unallocated: 0n };
}
