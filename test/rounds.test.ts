import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handle, type Env } from "../worker/index";
import { postgresRoundStore, type Round, type RoundStore } from "../worker/rounds";
import { memoryRoundStore } from "./memoryRoundStore";

const env: Env = {
  ASSETS: { fetch: async () => new Response("<!doctype html>", { status: 200 }) } as unknown as Fetcher,
};

const round = {
  allocation_amount: 100,
  investor_amounts: [
    { name: "Investor A", requested_amount: 100, average_amount: 100 },
    { name: "Investor B", requested_amount: 25, average_amount: 25 },
  ],
};

const request = (store: RoundStore | null, path: string, init?: RequestInit) =>
  handle(new Request(`https://example.com${path}`, init), env, store);

describe("saved rounds API", () => {
  let store: RoundStore;
  beforeEach(() => {
    store = memoryRoundStore();
  });

  it("saves a round with its prorated result and reads it back", async () => {
    const created = await request(store, "/api/rounds", { method: "POST", body: JSON.stringify(round) });
    expect(created.status).toBe(201);
    const saved = (await created.json()) as Round;
    expect(saved.result).toEqual({ "Investor A": 80, "Investor B": 20 });

    const fetched = await request(store, `/api/rounds/${saved.id}`);
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toEqual(saved);

    const list = (await (await request(store, "/api/rounds")).json()) as Round[];
    expect(list.map((r) => r.id)).toEqual([saved.id]);
  });

  it("validates input before saving", async () => {
    const res = await request(store, "/api/rounds", { method: "POST", body: JSON.stringify({ allocation_amount: -1, investor_amounts: [] }) });
    expect(res.status).toBe(400);
    expect(await store.list(10)).toEqual([]);
  });

  it("returns 404 for unknown rounds", async () => {
    expect((await request(store, "/api/rounds/00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });

  it("answers 503 for rounds when no database is configured, while the calculator still works", async () => {
    expect((await request(null, "/api/rounds")).status).toBe(503);
    const prorated = await request(null, "/api/prorate", { method: "POST", body: JSON.stringify(round) });
    expect(prorated.status).toBe(200);
    expect(await (await request(null, "/api/health")).json()).toEqual({ status: "ok", database: "not configured" });
  });
});

// Runs against a real PostgreSQL when TEST_DATABASE_URL is set (CI provides one).
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("PostgreSQL round store", () => {
  const store = databaseUrl ? postgresRoundStore(databaseUrl) : memoryRoundStore();
  afterAll(() => store.close());

  it("persists rounds as jsonb and lists newest first", async () => {
    const first = await store.save(round, { "Investor A": 80, "Investor B": 20 });
    const second = await store.save({ ...round, allocation_amount: 200 }, { "Investor A": 100, "Investor B": 25 });

    expect(await store.get(first.id)).toEqual(first);
    expect(first.input).toEqual(round);
    const recent = await store.list(2);
    expect(recent.map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it("returns null for ids that are missing or not UUIDs", async () => {
    expect(await store.get("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(await store.get("not-a-uuid")).toBeNull();
  });
});
