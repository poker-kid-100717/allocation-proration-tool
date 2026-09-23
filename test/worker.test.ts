import { describe, expect, it } from "vitest";
import worker, { type Env } from "../worker/index";

const env: Env = {
  ASSETS: { fetch: async () => new Response("<!doctype html>", { status: 200 }) } as unknown as Fetcher,
};

const call = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://example.com${path}`, init), env);

describe("worker", () => {
  it("prorates a valid request", async () => {
    const res = await call("/api/prorate", {
      method: "POST",
      body: JSON.stringify({
        allocation_amount: 100,
        investor_amounts: [
          { name: "Investor A", requested_amount: 100, average_amount: 100 },
          { name: "Investor B", requested_amount: 25, average_amount: 25 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ "Investor A": 80, "Investor B": 20 });
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await call("/api/prorate", { method: "POST", body: "{not json" });
    expect(res.status).toBe(400);
  });

  it("returns 400 with a message for invalid input", async () => {
    const res = await call("/api/prorate", {
      method: "POST",
      body: JSON.stringify({ allocation_amount: -5, investor_amounts: [] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
  });

  it("rejects non-POST methods on the prorate endpoint", async () => {
    const res = await call("/api/prorate");
    expect(res.status).toBe(405);
  });

  it("returns 404 for unknown API routes", async () => {
    expect((await call("/api/nope")).status).toBe(404);
  });

  it("serves static assets for non-API paths", async () => {
    const res = await call("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<!doctype html>");
  });
});
