import { useState } from "react";
import { REVERSAL_METHODS, type CalculationRecord } from "../../engine";
import { Badge, Card, PageHeader } from "../components/ui";
import { count, money, timestamp } from "../format";
import { navigate } from "../router";
import { clearUserRecords, useHistory } from "../store";
import { SourceBadge } from "./Audit";

type Filter = "all" | "allocation" | "reversal";

export function History() {
  const history = useHistory();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const rows = history.filter((r) => (filter === "all" || r.kind === filter) && (q === "" || r.id.toLowerCase().includes(q) || r.label.toLowerCase().includes(q)));
  const userCount = history.filter((r) => r.source === "user").length;

  return (
    <>
      <PageHeader
        eyebrow="History"
        title="Calculation history"
        actions={
          <button
            type="button"
            className="secondary"
            disabled={userCount === 0}
            onClick={() => {
              if (window.confirm(`Delete the ${userCount} calculation(s) recorded in this browser? Seeded demo records stay.`)) clearUserRecords();
            }}
          >
            Clear my records
          </button>
        }
      >
        Every recorded allocation and reversal, newest first. Records are immutable: re-running with different inputs creates a new record, and a refund
        creates a reversal that points at the original. History is stored in this browser only.
      </PageHeader>

      <Card>
        <div className="table-toolbar">
          <div className="chips" role="group" aria-label="Filter by kind">
            {(["all", "allocation", "reversal"] as const).map((f) => (
              <button key={f} type="button" className={`chip ${filter === f ? "is-active" : ""}`} onClick={() => setFilter(f)} aria-pressed={filter === f}>
                {f === "all" ? "All" : f === "allocation" ? "Allocations" : "Reversals"}
              </button>
            ))}
          </div>
          <input className="search" placeholder="Search ID or label" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search history" />
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>ID</th>
                <th>Created</th>
                <th>Calculation</th>
                <th>Method</th>
                <th className="r">Amount</th>
                <th className="r">Allocated</th>
                <th className="r">Difference</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <HistoryRow key={r.id} record={r} />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    No calculations match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="muted small">{count(rows.length)} shown.</p>
      </Card>
    </>
  );
}

function HistoryRow({ record }: { record: CalculationRecord }) {
  const c = record.result.currency;
  const [method, amount, allocated, unallocated] =
    record.kind === "allocation"
      ? [`${record.result.strategy.name} v${record.result.strategy.version}`, record.result.amountMinor, record.result.totals.allocatedMinor, record.result.totals.unallocatedMinor]
      : [REVERSAL_METHODS[record.result.method].name, record.result.amountMinor, record.result.totals.reversedMinor, 0n];
  const difference = amount - allocated - unallocated;
  const open = () => navigate(`/history/${record.id}`);
  return (
    <tr className="clickable" onClick={open} onKeyDown={(e) => e.key === "Enter" && open()} tabIndex={0}>
      <td>
        <a href={`#/history/${record.id}`} className="mono" onClick={(e) => e.stopPropagation()}>
          {record.id}
        </a>
      </td>
      <td className="nowrap">{timestamp(record.createdAt)}</td>
      <td>
        {record.kind === "reversal" && <Badge tone="warn">reversal</Badge>} {record.label}
        {record.kind === "reversal" && <div className="sub">reverses {record.reversesRecordId}</div>}
      </td>
      <td>{method}</td>
      <td className="r num">{money(amount, c)}</td>
      <td className="r num">{money(allocated, c)}</td>
      <td className={`r num ${difference === 0n ? "ok" : "bad"}`}>{money(difference, c)}</td>
      <td>
        <SourceBadge record={record} />
      </td>
    </tr>
  );
}
