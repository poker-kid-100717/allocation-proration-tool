// Public surface of the allocation engine. Nothing here depends on React, the
// DOM, or the Workers runtime; the UI, the API and the tests all import it.
export * from "./domain";
export { allocate, fingerprintRequest, InvariantViolation } from "./allocation/allocate";
export { apportion, compareIds, RESIDUAL_TIE_BREAK, type Claimant, type Apportionment } from "./allocation/apportion";
export { reverseAllocation, REVERSAL_METHODS, REVERSAL_METHOD_VERSION } from "./allocation/reverse";
export { canonicalJson, fnv1a64 } from "./allocation/fingerprint";
export { SUPPORTED_CURRENCIES, getCurrency, isCurrencyCode, type Currency, type CurrencyCode } from "./money/currency";
export { parseMoney, toDecimalString, formatMoney, sumMinor, type Money } from "./money/money";
export { formatFraction, formatPercent, fraction, compareFractions, type Fraction } from "./money/fraction";
export { parseWeight, formatWeight, WEIGHT_DECIMALS } from "./money/weight";
export { STRATEGIES, STRATEGY_LIST, getStrategy } from "./strategies/registry";
export type { AllocationStrategy } from "./strategies/types";
export { validateRequest, MAX_OBLIGATIONS } from "./validation/validate";
export { resolveRules, UNPRIORITISED } from "./rules/resolve";
export { parseWireRequest, toWireRequest, toJsonSafe, type WireAllocationRequest, type WireObligation, type WireRule } from "./wire";
export * from "./records";
