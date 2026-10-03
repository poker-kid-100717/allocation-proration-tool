import postgres from "postgres";
import type { ProrationInput, ProrationResult } from "../src/lib/prorate";

/** One saved allocation round: the request, the prorated result, and when it was run. */
export interface Round {
  id: string;
  createdAt: string;
  input: ProrationInput;
  result: ProrationResult;
}

export interface RoundStore {
  save(input: ProrationInput, result: ProrationResult): Promise<Round>;
  list(limit: number): Promise<Round[]>;
  get(id: string): Promise<Round | null>;
  close(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Created on first use; idempotent, so every isolate can run it once.
const SCHEMA = `
  create table if not exists allocation_rounds (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    allocation_amount numeric not null,
    investor_count integer not null,
    input jsonb not null,
    result jsonb not null
  );
  create index if not exists allocation_rounds_created_at on allocation_rounds (created_at desc);
`;

let schemaReady: Promise<unknown> | null = null;

/**
 * Rounds in PostgreSQL (DATABASE_URL, for example a Neon pooled URL with ?sslmode=require). Inputs and results are
 * jsonb, with the allocation and investor count as columns so they can be queried and indexed directly.
 */
export function postgresRoundStore(databaseUrl: string): RoundStore {
  const sql = postgres(databaseUrl, { max: 1, fetch_types: false, prepare: false, connect_timeout: 5, onnotice: () => {} });
  const ready = () => (schemaReady ??= sql.unsafe(SCHEMA).catch((error) => { schemaReady = null; throw error; }));

  type Row = { id: string; created_at: Date; input: ProrationInput; result: ProrationResult };
  const toRound = (row: Row): Round => ({ id: row.id, createdAt: row.created_at.toISOString(), input: row.input, result: row.result });

  return {
    async save(input, result) {
      await ready();
      const [row] = await sql<Row[]>`
        insert into allocation_rounds (allocation_amount, investor_count, input, result)
        values (${input.allocation_amount}, ${input.investor_amounts.length}, ${sql.json(input as never)}, ${sql.json(result)})
        returning id, created_at, input, result`;
      return toRound(row);
    },
    async list(limit) {
      await ready();
      const rows = await sql<Row[]>`
        select id, created_at, input, result from allocation_rounds order by created_at desc, id limit ${limit}`;
      return rows.map(toRound);
    },
    async get(id) {
      if (!UUID.test(id)) return null;
      await ready();
      const [row] = await sql<Row[]>`select id, created_at, input, result from allocation_rounds where id = ${id}`;
      return row ? toRound(row) : null;
    },
    close: () => sql.end({ timeout: 1 }),
  };
}
