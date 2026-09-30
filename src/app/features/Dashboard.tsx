import { STRATEGIES, type AllocationRecord, type CurrencyCode, type StrategyId } from "../../engine";
import { SCENARIOS } from "../../scenarios/catalog";
import { Badge, Card, PageHeader, Stat } from "../components/ui";
import { count, money, plural, timestamp } from "../format";
import { href } from "../router";
import { useHistory } from "../store";
import { SourceBadge } from "./Audit";
import { loadScenarioIntoLab } from "./Lab";

export function Dashboard() {
  const history = useHistory();
  const allocations = history.filter((r): r is AllocationRecord => r.kind === "allocation");
  const reversals = history.length - allocations.length;
  const seeded = history.filter((r) => r.source === "seed").length;

  const totalsByCurrency = new Map<CurrencyCode, bigint>();
  const byStrategy = new Map<StrategyId, number>();
  let residualUnits = 0n;
  let roundedCalcs = 0;
  let balanced = 0;
  for (const a of allocations) {
    const { result } = a;
    totalsByCurrency.set(result.currency, (totalsByCurrency.get(result.currency) ?? 0n) + result.totals.allocatedMinor);
    byStrategy.set(result.strategy.id, (byStrategy.get(result.strategy.id) ?? 0) + 1);
    residualUnits += result.rounding.residualMinor;
    if (result.rounding.residualMinor > 0n) roundedCalcs++;
    if (result.totals.allocatedMinor + result.totals.unallocatedMinor === result.amountMinor) balanced++;
  }
  const maxStrategy = Math.max(1, ...byStrategy.values());

  return (
    <>
      <PageHeader eyebrow="Dashboard" title="Every cent accounted for">
        Prorata works out how an amount should be split across financial obligations (invoices, payees, transactions, refunds) and records an
        explainable, reproducible calculation for each split. It is a calculation engine and demo environment. It does not move money.
      </PageHeader>

      <p className="demo-note">
        Figures below summarise the calculation history stored <strong>in this browser</strong>: {plural(seeded, "seeded demo record")} plus anything you record.
        They are not production statistics.
      </p>

      <div className="stats">
        <Stat label="Allocations recorded" value={count(allocations.length)} hint={`${plural(reversals, "reversal")} recorded`} />
        <Stat
          label="Total amount allocated"
          value={
            <span className="stack">
              {[...totalsByCurrency].map(([c, v]) => (
                <span key={c}>{money(v, c)}</span>
              ))}
              {totalsByCurrency.size === 0 && "—"}
            </span>
          }
          hint="summed per currency, never converted"
        />
        <Stat label="Rounding adjustments" value={`${residualUnits.toString()} minor units`} hint={`residuals placed by largest remainder in ${plural(roundedCalcs, "calculation")}`} />
        <Stat label="Balanced" value={`${count(balanced)} / ${count(allocations.length)}`} hint="allocated + unallocated = amount" tone={balanced === allocations.length ? "good" : "bad"} />
      </div>

      <div className="two-col">
        <Card title="Recent calculations" actions={<a href={href("/history")}>View all</a>}>
          <ul className="recent">
            {history.slice(0, 6).map((r) => (
              <li key={r.id}>
                <a href={href(`/history/${r.id}`)}>
                  <span className="mono">{r.id}</span>
                  <span className="recent-label">
                    {r.kind === "reversal" && <Badge tone="warn">reversal</Badge>} {r.label}
                  </span>
                </a>
                <span className="recent-meta">
                  <span className="num">{money(r.result.amountMinor, r.result.currency)}</span>
                  <span className="muted small">{timestamp(r.createdAt)}</span>
                  <SourceBadge record={r} />
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Allocation strategies">
          <ul className="bars">
            {Object.values(STRATEGIES).map((s) => {
              const n = byStrategy.get(s.id) ?? 0;
              return (
                <li key={s.id}>
                  <div className="bars-label">
                    <span>{s.name}</span>
                    <span className="muted small">v{s.version}</span>
                  </div>
                  <div className="bars-track" aria-hidden>
                    <div style={{ width: `${(n / maxStrategy) * 100}%` }} />
                  </div>
                  <span className="num">{n}</span>
                </li>
              );
            })}
          </ul>
          <p className="muted small">Recorded allocations by strategy.</p>
        </Card>
      </div>

      <Card title="Scenario shortcuts" actions={<a href={href("/scenarios")}>All scenarios</a>}>
        <div className="shortcut-grid">
          {SCENARIOS.map((s) => (
            <button key={s.id} type="button" className="shortcut" onClick={() => loadScenarioIntoLab(s.id)}>
              <span className="eyebrow">{s.category}</span>
              <strong>{s.title}</strong>
              <span className="muted small">{s.summary}</span>
            </button>
          ))}
        </div>
      </Card>
    </>
  );
}
