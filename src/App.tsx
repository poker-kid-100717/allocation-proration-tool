import { useState, type FormEvent } from "react";
import type { ProrationResult } from "./lib/prorate";

interface InvestorRow {
  id: number;
  name: string;
  requested: string;
  average: string;
}

let nextId = 0;
const row = (name = "", requested = "", average = ""): InvestorRow => ({ id: nextId++, name, requested, average });

const EXAMPLE = {
  allocation: "100",
  investors: [row("Investor A", "100", "95"), row("Investor B", "2", "1"), row("Investor C", "1", "4")],
};

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function App() {
  const [allocation, setAllocation] = useState(EXAMPLE.allocation);
  const [investors, setInvestors] = useState<InvestorRow[]>(EXAMPLE.investors);
  // Results keep the allocation they were computed for, so editing the form
  // afterwards never mislabels them.
  const [results, setResults] = useState<{ allocation: number; amounts: ProrationResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const update = (id: number, field: keyof Omit<InvestorRow, "id">, value: string) =>
    setInvestors((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

  const remove = (id: number) => setInvestors((rows) => rows.filter((r) => r.id !== id));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/prorate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          allocation_amount: Number(allocation),
          investor_amounts: investors.map((r) => ({
            name: r.name.trim(),
            requested_amount: Number(r.requested),
            average_amount: Number(r.average),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setResults({ allocation: Number(allocation), amounts: data });
    } catch (err) {
      setResults(null);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const totalAllocated = results ? Object.values(results.amounts).reduce((a, b) => a + b, 0) : 0;

  return (
    <main className="container">
      <header>
        <h1>Allocation Proration</h1>
        <p className="lede">
          Split a limited investment allocation across investors in proportion to their historical average. No
          investor gets more than they asked for, and whatever a capped investor doesn't take is redistributed
          to the rest.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="card">
        <label className="field">
          <span>Total available allocation</span>
          <input
            type="number"
            min="0"
            step="any"
            required
            value={allocation}
            onChange={(e) => setAllocation(e.target.value)}
          />
        </label>

        <table className="investors">
          <thead>
            <tr>
              <th>Investor</th>
              <th>Requested</th>
              <th>Historical average</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {investors.map((r) => (
              <tr key={r.id}>
                <td data-label="Investor">
                  <input required placeholder="Name" value={r.name} onChange={(e) => update(r.id, "name", e.target.value)} />
                </td>
                <td data-label="Requested">
                  <input type="number" min="0" step="any" required value={r.requested} onChange={(e) => update(r.id, "requested", e.target.value)} />
                </td>
                <td data-label="Historical average">
                  <input type="number" min="0" step="any" required value={r.average} onChange={(e) => update(r.id, "average", e.target.value)} />
                </td>
                <td>
                  <button type="button" className="ghost" onClick={() => remove(r.id)} disabled={investors.length === 1} aria-label={`Remove ${r.name || "investor"}`}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="actions">
          <button type="button" className="secondary" onClick={() => setInvestors((rows) => [...rows, row()])}>
            Add investor
          </button>
          <button type="submit" disabled={loading}>
            {loading ? "Calculating…" : "Prorate"}
          </button>
        </div>

        {error && <p className="error" role="alert">{error}</p>}
      </form>

      {results && (
        <section className="card" aria-live="polite">
          <h2>Results</h2>
          <ul className="results">
            {Object.entries(results.amounts).map(([name, amount]) => (
              <li key={name}>
                <div className="result-row">
                  <span>{name}</span>
                  <strong>{currency.format(amount)}</strong>
                </div>
                <div className="bar">
                  <div style={{ width: `${totalAllocated ? (amount / totalAllocated) * 100 : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="total">
            Allocated {currency.format(totalAllocated)} of {currency.format(results.allocation)}
          </p>
        </section>
      )}

      <footer>
        <a href="https://github.com/poker-kid-100717/allocation-proration-tool">Source on GitHub</a>
      </footer>
    </main>
  );
}
