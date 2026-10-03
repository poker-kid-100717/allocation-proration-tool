import type { RoundStore, Round } from "../worker/rounds";

/** In-memory RoundStore for the Worker tests; the Postgres store has its own tests against a real database. */
export function memoryRoundStore(): RoundStore {
  const rounds: Round[] = [];
  return {
    async save(input, result) {
      const round = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), input, result };
      rounds.unshift(round);
      return round;
    },
    async list(limit) {
      return rounds.slice(0, limit);
    },
    async get(id) {
      return rounds.find((r) => r.id === id) ?? null;
    },
    async close() {},
  };
}
