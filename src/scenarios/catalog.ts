import type { ReversalMethod, WireAllocationRequest, WireObligation } from "../engine";

export interface ScenarioVariant {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly apply: (request: WireAllocationRequest) => WireAllocationRequest;
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly category: "Invoices" | "Settlement" | "Fees" | "Refunds" | "Credits" | "Rounding" | "Constraints" | "Scale";
  readonly summary: string;
  /** What makes this case hard, in one or two sentences. */
  readonly whyItMatters: string;
  readonly build: () => WireAllocationRequest;
  readonly variants: readonly ScenarioVariant[];
  /** Pre-filled reversal for refund scenarios. */
  readonly reversal?: { readonly amount: string; readonly method: ReversalMethod; readonly reason: string };
}

const withStrategy = (strategy: string) => (r: WireAllocationRequest) => ({ ...r, strategy });

/** mulberry32: a tiny seeded PRNG so generated scenarios are identical on every run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically generates `count` open invoices. Amounts are built from
 * integer cents (the PRNG only picks integers), then written as decimal strings.
 */
export function generateObligations(count: number, seed = 20260930): WireObligation[] {
  const rand = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => {
    const cents = 1_000 + Math.floor(rand() * 2_500_000); // $10.00 – $25,009.99
    const day = 1 + Math.floor(rand() * 28);
    const month = 1 + Math.floor(rand() * 9);
    return {
      id: `INV-${String(100_000 + i)}`,
      description: `Generated invoice ${i + 1}`,
      outstanding: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`,
      dueDate: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    };
  });
}

const equalRecipients = (amount: string, currency: string, outstanding: string, count = 3): WireAllocationRequest => ({
  amount,
  currency,
  strategy: "equal",
  obligations: Array.from({ length: count }, (_, i) => ({
    id: `RCP-${String.fromCharCode(65 + i)}`,
    description: `Recipient ${String.fromCharCode(65 + i)}`,
    outstanding,
  })),
});

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "partial-invoice-payment",
    title: "Partial invoice payment",
    category: "Invoices",
    summary: "A customer owes $10,000.00 across three invoices and remits $7,500.00. How much of the payment goes to each invoice?",
    whyItMatters:
      "Pro rata keeps every invoice equally current; oldest-first clears whole invoices and ages the rest. Same money, different receivables, and each choice has to be reproducible for the customer statement.",
    build: () => ({
      amount: "7500.00",
      currency: "USD",
      strategy: "proportional",
      obligations: [
        { id: "INV-101", description: "Northwind Traders: April services", original: "4200.00", outstanding: "4200.00", dueDate: "2026-05-15" },
        { id: "INV-102", description: "Northwind Traders: May services", original: "2800.00", outstanding: "2800.00", dueDate: "2026-06-01" },
        { id: "INV-103", description: "Northwind Traders: June services", original: "3000.00", outstanding: "3000.00", dueDate: "2026-06-15" },
      ],
    }),
    variants: [
      { id: "proportional", label: "Proportional", note: "Split by outstanding balance: $3,150 / $2,100 / $2,250.", apply: withStrategy("proportional") },
      { id: "oldest-first", label: "Oldest first", note: "Clear invoices in due-date order: $4,200 / $2,800 / $500.", apply: withStrategy("priority") },
    ],
  },
  {
    id: "marketplace-settlement",
    title: "Marketplace settlement",
    category: "Settlement",
    summary: "A $1,000.00 customer payment is split between the merchant, the platform, the payment processor and an affiliate.",
    whyItMatters:
      "Revenue shares are percentages but payouts are cents. On an odd total like $999.99 the shares don't come out to whole cents, and the leftover cents still have to land with a payee deterministically.",
    build: () => ({
      amount: "1000.00",
      currency: "USD",
      strategy: "weighted",
      obligations: [
        { id: "MERCHANT", description: "Seller of record: 85% revenue share", outstanding: "1000.00", weight: "85" },
        { id: "PLATFORM", description: "Marketplace commission: 10%", outstanding: "1000.00", weight: "10" },
        { id: "PROCESSOR", description: "Card processing: 3%", outstanding: "1000.00", weight: "3" },
        { id: "AFFILIATE", description: "Referral partner: 2%", outstanding: "1000.00", weight: "2" },
      ],
    }),
    variants: [
      { id: "weighted", label: "85 / 10 / 3 / 2", note: "Percent shares of $1,000.00 are exact.", apply: (r) => r },
      {
        id: "odd-total",
        label: "Odd total ($999.99)",
        note: "Shares land on fractions of a cent; three residual cents go to the largest remainders.",
        apply: (r) => ({ ...r, amount: "999.99" }),
      },
      {
        id: "fixed-fee",
        label: "Fixed processor fee",
        note: "Processor takes a fixed $30.00 off the top; the other $970.00 is split 85 / 10 / 2.",
        apply: (r) => ({
          ...r,
          strategy: "fixed-remainder",
          obligations: r.obligations.map((o) => (o.id === "PROCESSOR" ? { ...o, weight: undefined, fixed: "30.00", description: "Card processing: fixed $30.00" } : o)),
        }),
      },
    ],
  },
  {
    id: "processor-fee-allocation",
    title: "Processor fee allocation",
    category: "Fees",
    summary: "A processor bills one $87.43 fee for a batch of seven card transactions. Each transaction's share of the fee is needed for per-order margin reporting.",
    whyItMatters:
      "Batch fees almost never divide evenly across transactions. Rounding each share on its own loses or invents cents; the per-transaction fees have to add back up to exactly what the processor billed.",
    build: () => ({
      amount: "87.43",
      currency: "USD",
      strategy: "proportional",
      obligations: [
        { id: "TXN-80341", description: "Card sale", outstanding: "1249.99" },
        { id: "TXN-80342", description: "Card sale", outstanding: "87.50" },
        { id: "TXN-80343", description: "Card sale", outstanding: "412.00" },
        { id: "TXN-80344", description: "Card sale", outstanding: "2030.15" },
        { id: "TXN-80345", description: "Card sale", outstanding: "19.99" },
        { id: "TXN-80346", description: "Card sale", outstanding: "640.00" },
        { id: "TXN-80347", description: "Card sale", outstanding: "555.55" },
      ],
    }),
    variants: [],
  },
  {
    id: "refund-allocation",
    title: "Refund allocation",
    category: "Refunds",
    summary: "A $1,000.00 payment settled Invoice A ($600.00) and Invoice B ($400.00). The customer is later refunded $250.00. Which invoices does the refund reopen?",
    whyItMatters:
      "The original allocation is a financial record and must not be edited. The reversal is a new calculation that points back at it, and a series of partial refunds must never reverse more than an invoice received.",
    build: () => ({
      amount: "1000.00",
      currency: "USD",
      strategy: "proportional",
      obligations: [
        { id: "INV-A", description: "Invoice A", outstanding: "600.00", dueDate: "2026-07-01" },
        { id: "INV-B", description: "Invoice B", outstanding: "400.00", dueDate: "2026-08-01" },
      ],
    }),
    variants: [],
    reversal: { amount: "250.00", method: "proportional", reason: "Partial refund: returned goods" },
  },
  {
    id: "credit-allocation",
    title: "Credit allocation",
    category: "Credits",
    summary: "A customer is issued a $500.00 service credit, to be applied oldest invoice first. One invoice is under dispute, and policy limits a credit to $250.00 on any one invoice.",
    whyItMatters:
      "Business rules take priority over the arithmetic. The disputed invoice must get nothing, the cap must hold, and whatever a capped invoice can't absorb moves on to the next invoice in line.",
    build: () => ({
      amount: "500.00",
      currency: "USD",
      strategy: "priority",
      obligations: [
        { id: "INV-2031", description: "Subscription: March", outstanding: "180.00", dueDate: "2026-03-01" },
        { id: "INV-2044", description: "Professional services (disputed)", outstanding: "260.00", dueDate: "2026-03-15" },
        { id: "INV-2051", description: "Subscription: April + overage", outstanding: "400.00", dueDate: "2026-04-01" },
        { id: "INV-2063", description: "Subscription: May", outstanding: "90.00", dueDate: "2026-04-20" },
      ],
      rules: [
        { kind: "exclude", obligationId: "INV-2044", label: "Disputed: hold credits" },
        { kind: "cap", obligationId: "INV-2051", amount: "250.00", label: "Credit policy: $250 per invoice" },
      ],
    }),
    variants: [
      { id: "oldest-first", label: "Oldest first", note: "$180.00 / $0.00 (excluded) / $250.00 (capped) / $70.00.", apply: withStrategy("priority") },
      { id: "proportional", label: "Proportional", note: "Same rules, split by balance instead.", apply: withStrategy("proportional") },
    ],
  },
  {
    id: "rounding-edge-case",
    title: "Rounding edge case",
    category: "Rounding",
    summary: "$100.00 split equally across three recipients. $33.33 × 3 comes to $99.99. Where does the last cent go?",
    whyItMatters:
      "Rounding each share on its own loses a cent. Largest remainder hands the residual cent out by a documented rule. The remainders here are identical, so the tie-break (priority, then ID) decides, and it decides the same way on every run.",
    build: () => equalRecipients("100.00", "USD", "1000.00"),
    variants: [
      { id: "100-3", label: "$100.00 ÷ 3", note: "$33.34 / $33.33 / $33.33", apply: (r) => r },
      { id: "0.01-3", label: "$0.01 ÷ 3", note: "One cent, three recipients: $0.01 / $0.00 / $0.00", apply: () => equalRecipients("0.01", "USD", "1000.00") },
      { id: "0.02-3", label: "$0.02 ÷ 3", note: "$0.01 / $0.01 / $0.00", apply: () => equalRecipients("0.02", "USD", "1000.00") },
      { id: "10000-7", label: "$10,000.00 ÷ 7", note: "$1,428.57 × 7 = $9,999.99; the residual cent goes to recipient A", apply: () => equalRecipients("10000.00", "USD", "5000.00", 7) },
      { id: "jpy", label: "¥1,000 ÷ 3 (JPY)", note: "Zero-decimal currency: the residual is a whole yen, ¥334 / ¥333 / ¥333", apply: () => equalRecipients("1000", "JPY", "100000") },
      { id: "kwd", label: "KD 1.000 ÷ 7 (KWD)", note: "Three-decimal currency: six residual fils (0.001 each) go to six of seven recipients", apply: () => equalRecipients("1.000", "KWD", "10.000", 7) },
    ],
  },
  {
    id: "capped-redistribution",
    title: "Capped redistribution",
    category: "Constraints",
    summary: "$100.00 is offered to three participants in proportion to their historical weight, but nobody may receive more than they requested.",
    whyItMatters:
      "Clamping each share with min(share, cap) leaves money unallocated. The surplus from a capped participant has to be re-split among the rest, sometimes over several rounds, and the rounding still has to close to the cent.",
    build: () => ({
      amount: "100.00",
      currency: "USD",
      strategy: "weighted",
      obligations: [
        { id: "PART-A", description: "Requested $100.00, weight 95", outstanding: "100.00", weight: "95" },
        { id: "PART-B", description: "Requested $2.00, weight 1", outstanding: "2.00", weight: "1" },
        { id: "PART-C", description: "Requested $1.00, weight 4", outstanding: "1.00", weight: "4" },
      ],
    }),
    variants: [
      { id: "one-round", label: "One cap", note: "C is capped at $1.00; A and B split $99.00 by 95:1, giving $97.97 / $1.03.", apply: (r) => r },
      {
        id: "two-rounds",
        label: "Cascading caps",
        note: "C is capped in round 1; re-splitting its surplus pushes B past its $1.02 request in round 2; A receives $97.98.",
        apply: (r) => ({ ...r, obligations: r.obligations.map((o) => (o.id === "PART-B" ? { ...o, outstanding: "1.02", description: "Requested $1.02, weight 1" } : o)) }),
      },
      {
        id: "all-capped",
        label: "Everyone capped",
        note: "$200.00 against $103.00 of capacity: every participant is capped and $97.00 is reported as unallocated rather than created or lost.",
        apply: (r) => ({ ...r, amount: "200.00" }),
      },
    ],
  },
  {
    id: "large-allocation",
    title: "Large allocation",
    category: "Scale",
    summary: "$1,234,567.89 applied pro rata across 2,500 generated invoices, with every cent accounted for.",
    whyItMatters:
      "Thousands of residual cents have to be placed by an ordering that doesn't depend on hash-map iteration, sort stability or locale. The engine sorts by exact bigint remainders with a total-order tie-break.",
    build: () => ({ amount: "1234567.89", currency: "USD", strategy: "proportional", obligations: generateObligations(2_500) }),
    variants: [
      { id: "2500", label: "2,500 invoices", note: "Pro rata, $1,234,567.89.", apply: (r) => r },
      {
        id: "10000",
        label: "10,000 invoices",
        note: "Pro rata, $9,876,543.21.",
        apply: (r) => ({ ...r, amount: "9876543.21", obligations: generateObligations(10_000) }),
      },
      { id: "oldest-first", label: "Oldest first", note: "Due-date waterfall over the same 2,500 invoices.", apply: withStrategy("priority") },
    ],
  },
];

export const getScenario = (id: string) => SCENARIOS.find((s) => s.id === id);

export function buildScenarioRequest(scenarioId: string, variantId?: string): WireAllocationRequest | undefined {
  const scenario = getScenario(scenarioId);
  if (!scenario) return undefined;
  const base = scenario.build();
  const variant = scenario.variants.find((v) => v.id === variantId);
  return variant ? variant.apply(base) : base;
}
