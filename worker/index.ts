import { prorate, validateInput } from "../src/lib/prorate";

export interface Env {
  ASSETS: Fetcher;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ status: "ok" });
    }

    if (url.pathname === "/api/prorate") {
      if (request.method !== "POST") {
        return new Response(null, { status: 405, headers: { allow: "POST" } });
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Request body must be valid JSON." }, 400);
      }

      const input = validateInput(body);
      if (!input.ok) return json({ error: input.error }, 400);

      return json(prorate(input.value));
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found." }, 404);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
