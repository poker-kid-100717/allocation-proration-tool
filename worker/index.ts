import { prorate, validateInput } from "../src/lib/prorate";
import { postgresRoundStore, type RoundStore } from "./rounds";

export interface Env {
  ASSETS: Fetcher;
  /** PostgreSQL URL (for example Neon). Without it the calculator works and saved rounds are unavailable. */
  DATABASE_URL?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

async function readInput(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: json({ error: "Request body must be valid JSON." }, 400) };
  }
  const input = validateInput(body);
  return input.ok ? { input: input.value } : { response: json({ error: input.error }, 400) };
}

/** Routes one request. `rounds` is null when no database is configured. */
export async function handle(request: Request, env: Env, rounds: RoundStore | null): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    return json({ status: "ok", database: rounds ? "configured" : "not configured" });
  }

  if (url.pathname === "/api/prorate") {
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    }
    const read = await readInput(request);
    if (read.response) return read.response;
    return json(prorate(read.input));
  }

  if (url.pathname === "/api/rounds" || url.pathname.startsWith("/api/rounds/")) {
    if (!rounds) return json({ error: "Saved rounds need a database (DATABASE_URL)." }, 503);

    if (url.pathname === "/api/rounds") {
      if (request.method === "GET") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);
        return json(await rounds.list(limit));
      }
      if (request.method === "POST") {
        const read = await readInput(request);
        if (read.response) return read.response;
        return json(await rounds.save(read.input, prorate(read.input)), 201);
      }
      return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
    }

    if (request.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET" } });
    const round = await rounds.get(decodeURIComponent(url.pathname.slice("/api/rounds/".length)));
    return round ? json(round) : json({ error: "Round not found." }, 404);
  }

  if (url.pathname.startsWith("/api/")) {
    return json({ error: "Not found." }, 404);
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const needsDatabase = new URL(request.url).pathname.startsWith("/api/rounds");
    const rounds = needsDatabase && env.DATABASE_URL ? postgresRoundStore(env.DATABASE_URL) : null;
    try {
      return await handle(request, env, rounds);
    } catch (error) {
      console.error(JSON.stringify({ event: "request_failed", message: String((error as Error)?.message ?? error) }));
      return json({ error: "The database is unavailable. Try again shortly." }, 503);
    } finally {
      if (rounds) ctx.waitUntil(rounds.close());
    }
  },
} satisfies ExportedHandler<Env>;
