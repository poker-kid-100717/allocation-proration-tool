import type { StrategyId } from "../domain";
import { equal, fixedRemainder, priority, proportional, weighted } from "./strategies";
import type { AllocationStrategy } from "./types";

export const STRATEGIES: Readonly<Record<StrategyId, AllocationStrategy>> = {
  proportional,
  priority,
  equal,
  weighted,
  "fixed-remainder": fixedRemainder,
};

export const STRATEGY_LIST: readonly AllocationStrategy[] = Object.values(STRATEGIES);

export const getStrategy = (id: StrategyId): AllocationStrategy => STRATEGIES[id];
