import { expect, it } from "vitest";
import { allocate, parseWireRequest, type AllocationRequest } from "../src/engine";
import { generateObligations } from "../src/scenarios/catalog";

// Run with `npm run bench`. Prints median wall-clock time per allocation.
const request = (count: number, strategy: string): AllocationRequest => {
  const parsed = parseWireRequest({ amount: "9876543.21", currency: "USD", strategy, obligations: generateObligations(count) });
  if (!parsed.ok) throw new Error("invalid benchmark request");
  return parsed.value;
};

function median(fn: () => void, runs: number): number {
  fn(); // warm-up
  const times = Array.from({ length: runs }, () => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

it("allocation benchmark", () => {
  const lines = [`| Obligations | proportional | equal | priority |`, `| ---: | ---: | ---: | ---: |`];
  for (const count of [100, 1_000, 10_000]) {
    const cells = ["proportional", "equal", "priority"].map((strategy) => {
      const r = request(count, strategy);
      return `${median(() => allocate(r), count >= 10_000 ? 7 : 25).toFixed(1)} ms`;
    });
    lines.push(`| ${count.toLocaleString("en-US")} | ${cells.join(" | ")} |`);
  }
  expect(lines).toHaveLength(5);
  process.stdout.write(`\nMedian time per allocate() call (includes validation, audit trail and invariant checks):\n\n${lines.join("\n")}\n\n`);
});
