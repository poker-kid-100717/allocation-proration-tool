export interface InvestorRequest {
  name: string;
  requested_amount: number;
  average_amount: number;
}

export interface ProrationInput {
  allocation_amount: number;
  investor_amounts: InvestorRequest[];
}

export type ProrationResult = Record<string, number>;

/**
 * Distributes `allocation_amount` across investors in proportion to their
 * historical average investment, never giving anyone more than they requested.
 *
 * Whenever a proportional share would exceed an investor's request, that
 * investor is capped and the surplus is redistributed across the remaining
 * investors, again by historical average. This repeats until no share
 * exceeds a request, so the whole allocation is used whenever demand allows.
 */
export function prorate({ allocation_amount, investor_amounts }: ProrationInput): ProrationResult {
  const result: ProrationResult = {};
  for (const inv of investor_amounts) result[inv.name] = 0;

  const totalRequested = investor_amounts.reduce((sum, inv) => sum + inv.requested_amount, 0);
  if (totalRequested <= allocation_amount) {
    for (const inv of investor_amounts) result[inv.name] = inv.requested_amount;
    return result;
  }

  let remaining = allocation_amount;
  let eligible = investor_amounts.filter((inv) => inv.requested_amount > 0);

  while (eligible.length > 0 && remaining > 0) {
    const totalAverage = eligible.reduce((sum, inv) => sum + inv.average_amount, 0);
    // Investors with no history still get a fair share when nobody has history.
    const weight = (inv: InvestorRequest) =>
      totalAverage > 0 ? inv.average_amount / totalAverage : 1 / eligible.length;

    const capped = eligible.filter((inv) => remaining * weight(inv) >= inv.requested_amount);

    if (capped.length === 0) {
      for (const inv of eligible) result[inv.name] = remaining * weight(inv);
      return result;
    }

    for (const inv of capped) {
      result[inv.name] = inv.requested_amount;
      remaining -= inv.requested_amount;
    }
    eligible = eligible.filter((inv) => !capped.includes(inv));
  }

  return result;
}

export type ValidationResult =
  | { ok: true; value: ProrationInput }
  | { ok: false; error: string };

const isNonNegativeNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

export function validateInput(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const { allocation_amount, investor_amounts } = body as Record<string, unknown>;

  if (!isNonNegativeNumber(allocation_amount)) {
    return { ok: false, error: "allocation_amount must be a non-negative number." };
  }
  if (!Array.isArray(investor_amounts) || investor_amounts.length === 0) {
    return { ok: false, error: "investor_amounts must be a non-empty array." };
  }

  const names = new Set<string>();
  for (const [i, inv] of investor_amounts.entries()) {
    const { name, requested_amount, average_amount } = (inv ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || name.trim() === "") {
      return { ok: false, error: `investor_amounts[${i}].name must be a non-empty string.` };
    }
    if (names.has(name)) {
      return { ok: false, error: `Duplicate investor name "${name}".` };
    }
    names.add(name);
    if (!isNonNegativeNumber(requested_amount)) {
      return { ok: false, error: `investor_amounts[${i}].requested_amount must be a non-negative number.` };
    }
    if (!isNonNegativeNumber(average_amount)) {
      return { ok: false, error: `investor_amounts[${i}].average_amount must be a non-negative number.` };
    }
  }

  return { ok: true, value: { allocation_amount, investor_amounts: investor_amounts as InvestorRequest[] } };
}
