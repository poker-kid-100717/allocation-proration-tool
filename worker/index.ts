import {
  allocate,
  ENGINE_VERSION,
  parseMoney,
  parseWireRequest,
  REVERSAL_METHODS,
  reverseAllocation,
  STRATEGY_LIST,
  SUPPORTED_CURRENCIES,
  toDecimalString,
  toJsonSafe,
  type AllocationResult,
  type ReversalMethod,
  type ValidationIssue,
} from "../src/engine";

export interface Env {
  ASSETS: Fetcher;
}

// Not exported: a Worker entry module may only export handlers.
/** Requests above this size are refused before parsing (10,000 obligations fit comfortably). */
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const API_MAX_OBLIGATIONS = 10_000;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const invalid = (errors: readonly ValidationIssue[]) => json({ error: "Invalid allocation request.", issues: errors }, 422);

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return { ok: false, response: json({ error: `Request body exceeds ${MAX_BODY_BYTES} bytes.` }, 413) };
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, response: json({ error: `Request body exceeds ${MAX_BODY_BYTES} bytes.` }, 413) };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: json({ error: "Request body must be valid JSON." }, 400) };
  }
}

/** A compact, human-readable view alongside the full result (amounts in major units). */
function summarize(result: AllocationResult) {
  const d = (m: bigint) => toDecimalString(m, result.currency);
  return {
    currency: result.currency,
    amount: d(result.amountMinor),
    allocated: d(result.totals.allocatedMinor),
    unallocated: d(result.totals.unallocatedMinor),
    difference: d(result.amountMinor - result.totals.allocatedMinor - result.totals.unallocatedMinor),
    allocations: Object.fromEntries(result.lines.map((l) => [l.obligationId, d(l.allocatedMinor)])),
  };
}

function handleAllocate(body: unknown): Response {
  const parsed = parseWireRequest(body);
  if (!parsed.ok) return invalid(parsed.errors);
  if (parsed.value.obligations.length > API_MAX_OBLIGATIONS) {
    return invalid([{ path: "obligations", message: `the API accepts at most ${API_MAX_OBLIGATIONS.toLocaleString("en-US")} obligations per request` }]);
  }
  const outcome = allocate(parsed.value);
  if (!outcome.ok) return invalid(outcome.errors);
  return json({ summary: summarize(outcome.value), result: toJsonSafe(outcome.value) });
}

/**
 * Stateless reversal: the caller sends the original allocation *request* and
 * the refund. Because allocation is deterministic, the Worker recomputes the
 * original result instead of trusting a client-supplied one.
 */
function handleReverse(body: unknown): Response {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const parsed = parseWireRequest(b.original);
  if (!parsed.ok) return invalid(parsed.errors.map((e) => ({ ...e, path: `original.${e.path}` })));
  const original = allocate(parsed.value);
  if (!original.ok) return invalid(original.errors.map((e) => ({ ...e, path: `original.${e.path}` })));

  const method = b.method ?? "proportional";
  if (typeof method !== "string" || !Object.hasOwn(REVERSAL_METHODS, method)) {
    return invalid([{ path: "method", message: `must be one of ${Object.keys(REVERSAL_METHODS).join(", ")}` }]);
  }
  if (typeof b.amount !== "string") return invalid([{ path: "amount", message: "must be a decimal string" }]);
  const amount = parseMoney(b.amount, parsed.value.currency);
  if (!amount.ok) return invalid([{ path: "amount", message: amount.error }]);

  const reversal = reverseAllocation(
    { request: parsed.value, result: original.value },
    { amountMinor: amount.value, method: method as ReversalMethod, reason: typeof b.reason === "string" ? b.reason : undefined },
  );
  if (!reversal.ok) return invalid(reversal.errors);
  const d = (m: bigint) => toDecimalString(m, parsed.value.currency);
  return json({
    summary: {
      currency: parsed.value.currency,
      reversed: d(reversal.value.totals.reversedMinor),
      reversals: Object.fromEntries(reversal.value.lines.map((l) => [l.obligationId, d(l.reversedMinor)])),
    },
    original: summarize(original.value),
    result: toJsonSafe(reversal.value),
  });
}

const metadata = () => ({
  engineVersion: ENGINE_VERSION,
  strategies: STRATEGY_LIST.map((s) => ({ id: s.id, version: s.version, name: s.name, summary: s.summary, residualHandling: s.residualHandling })),
  reversalMethods: Object.entries(REVERSAL_METHODS).map(([id, m]) => ({ id, ...m })),
  currencies: SUPPORTED_CURRENCIES,
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = url.pathname.replace(/\/+$/, "");

    if (route === "/api/health") return json({ status: "ok", engineVersion: ENGINE_VERSION });
    if (route === "/api/meta") return json(metadata());

    if (route === "/api/allocate" || route === "/api/reverse") {
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
      const read = await readJson(request);
      if (!read.ok) return read.response;
      return route === "/api/allocate" ? handleAllocate(read.body) : handleReverse(read.body);
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
