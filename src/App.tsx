import { useState, type FormEvent } from "react";
import { prorate, validateInput, type ProrationInput, type ProrationResult } from "./lib/prorate";

const browserDemo = import.meta.env.MODE === "demo";

interface InvestorRow {
  id: number;
  name: string;
  requested: string;
  average: string;
}

let nextId = 0;
const row = (name = "", requested = "", average = ""): InvestorRow => ({ id: nextId++, name, requested, average });

const example = () => ({
  allocation: "100",
  investors: [row("Investor A", "100", "95"), row("Investor B", "2", "1"), row("Investor C", "1", "4")],
});

function toInput(allocation: string, investors: InvestorRow[]): ProrationInput {
  return {
    allocation_amount: Number(allocation),
    investor_amounts: investors.map((r) => ({
      name: r.name.trim(), requested_amount: Number(r.requested), average_amount: Number(r.average),
    })),
  };
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function App() {
  const [allocation, setAllocation] = useState("100");
  const [investors, setInvestors] = useState<InvestorRow[]>(() => example().investors);
  // Results keep the allocation they were computed for, so editing the form
  // afterwards never mislabels them.
  const [results, setResults] = useState<{ allocation: number; amounts: ProrationResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const update = (id: number, field: keyof Omit<InvestorRow, "id">, value: string) =>
    setInvestors((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

  const remove = (id: number) => setInvestors((rows) => rows.filter((r) => r.id !== id));

  const calculate = async (input: ProrationInput) => {
    setError(null);
    setLoading(true);
    try {
      const validated = validateInput(input);
      if (!validated.ok) throw new Error(validated.error);
      let amounts: ProrationResult;
      if (browserDemo) {
        amounts = prorate(validated.value);
      } else {
        const res = await fetch("/api/prorate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(validated.value),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
        amounts = data;
      }
      setResults({ allocation: validated.value.allocation_amount, amounts });
    } catch (err) {
      setResults(null);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void calculate(toInput(allocation, investors));
  };

  const tryDemo = () => {
    const sample = example();
    setAllocation(sample.allocation);
    setInvestors(sample.investors);
    void calculate(toInput(sample.allocation, sample.investors));
  };

  const totalAllocated = results ? Object.values(results.amounts).reduce((a, b) => a + b, 0) : 0;

  return (
    <main className="container">
      <header>
        <p className="eyebrow">ALLOCATION WORKSPACE · SOFTWARE DEMO</p>
        <h1>Allocation Proration</h1>
        <p className="lede">
          Split a limited investment allocation across investors in proportion to their historical average. No
          investor gets more than they asked for, and whatever a capped investor doesn't take is redistributed
          to the rest.
        </p>
        <div className="demo-banner">
          <div><strong>Explore a sample allocation</strong><p>Try three fictional investors and see how capped requests redistribute the remaining amount.</p></div>
          <button type="button" onClick={tryDemo} disabled={loading}>Try demo</button>
        </div>
        <p className="demo-note">{browserDemo ? "Calculations run locally in your browser; inputs are not sent to the application server." : "Use fictional data in this demo."} Illustrative results only, not a regulated financial or settlement system.</p>
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
                  <input required aria-label={`Investor ${r.id + 1} name`} placeholder="Name" value={r.name} onChange={(e) => update(r.id, "name", e.target.value)} />
                </td>
                <td data-label="Requested">
                  <input type="number" min="0" step="any" required aria-label={`${r.name || "Investor"} requested amount`} value={r.requested} onChange={(e) => update(r.id, "requested", e.target.value)} />
                </td>
                <td data-label="Historical average">
                  <input type="number" min="0" step="any" required aria-label={`${r.name || "Investor"} historical average`} value={r.average} onChange={(e) => update(r.id, "average", e.target.value)} />
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
          <p className="demo-note">Displayed amounts are rounded for readability; the engine uses floating-point arithmetic and does not implement cent-exact settlement.</p>
        </section>
      )}

      <footer>
        <a href="https://github.com/poker-kid-100717/allocation-proration-tool">Source on GitHub</a>
      </footer>
    </main>
  );
}
