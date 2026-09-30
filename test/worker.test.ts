import { describe, expect, it } from "vitest";
import worker, { type Env } from "../worker/index";

const env: Env = {
  ASSETS: { fetch: async () => new Response("<!doctype html>", { status: 200 }) } as unknown as Fetcher,
};

const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://example.com${path}`, init), env);
const post = (path: string, body: unknown) => call(path, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

const partialPayment = {
  amount: "7500.00",
  currency: "USD",
  strategy: "proportional",
  obligations: [
    { id: "INV-101", outstanding: "4200.00" },
    { id: "INV-102", outstanding: "2800.00" },
    { id: "INV-103", outstanding: "3000.00" },
  ],
};

describe("worker API", () => {
  it("allocates a partial payment", async () => {
    const res = await post("/api/allocate", partialPayment);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: Record<string, unknown>; result: { inputFingerprint: string; lines: unknown[] } };
    expect(body.summary).toEqual({
      currency: "USD",
      amount: "7500.00",
      allocated: "7500.00",
      unallocated: "0.00",
      difference: "0.00",
      allocations: { "INV-101": "3150.00", "INV-102": "2100.00", "INV-103": "2250.00" },
    });
    expect(body.result.inputFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(body.result.lines).toHaveLength(3);
  });

  it("returns identical responses for identical requests", async () => {
    const a = await (await post("/api/allocate", partialPayment)).text();
    const b = await (await post("/api/allocate", partialPayment)).text();
    expect(a).toBe(b);
  });

  it("reverses statelessly by recomputing the original", async () => {
    const res = await post("/api/reverse", { original: { ...partialPayment, amount: "1000.00", obligations: [{ id: "A", outstanding: "600.00" }, { id: "B", outstanding: "400.00" }] }, amount: "250.00" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { summary: unknown }).summary).toEqual({ currency: "USD", reversed: "250.00", reversals: { A: "150.00", B: "100.00" } });
  });

  it("rejects a reversal larger than the allocation", async () => {
    const res = await post("/api/reverse", { original: partialPayment, amount: "7500.01" });
    expect(res.status).toBe(422);
  });

  it("returns 422 with every validation issue", async () => {
    const res = await post("/api/allocate", { ...partialPayment, amount: 7500, obligations: [{ id: "A", outstanding: "1.001" }] });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: { path: string }[] };
    expect(body.issues.map((i) => i.path)).toEqual(["amount", "obligations[0].outstanding"]);
  });

  it("returns 400 for malformed JSON", async () => {
    expect((await post("/api/allocate", "{not json")).status).toBe(400);
  });

  it("returns 413 for oversized bodies", async () => {
    expect((await post("/api/allocate", "x".repeat(4 * 1024 * 1024 + 1))).status).toBe(413);
  });

  it("rejects non-POST methods", async () => {
    const res = await call("/api/allocate");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("serves health and metadata", async () => {
    expect(await (await call("/api/health")).json()).toMatchObject({ status: "ok" });
    const meta = (await (await call("/api/meta")).json()) as { strategies: { id: string }[]; currencies: { code: string; minorUnits: number }[] };
    expect(meta.strategies.map((s) => s.id)).toEqual(["proportional", "priority", "equal", "weighted", "fixed-remainder"]);
    expect(meta.currencies).toContainEqual(expect.objectContaining({ code: "JPY", minorUnits: 0 }));
  });

  it("returns 404 for unknown API routes and serves assets otherwise", async () => {
    expect((await call("/api/nope")).status).toBe(404);
    expect(await (await call("/lab")).text()).toContain("<!doctype html>");
  });
});
