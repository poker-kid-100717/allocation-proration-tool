import { useMemo, useState } from "react";
import {
  allocate,
  formatFraction,
  getCurrency,
  parseMoney,
  REVERSAL_METHODS,
  reverseAllocation,
  toJsonSafe,
  toWireRequest,
  type AllocationRecord,
  type CalculationRecord,
  type ReversalMethod,
  type ReversalRecord,
} from "../../engine";
import { AllocationTable, BalanceCheck, DistributionTree, Invariants, RoundingDetail, Steps } from "../components/result";
import { Badge, Card, KeyValues, Mono, PageHeader } from "../components/ui";
import { count, money, timestamp } from "../format";
import { href, navigate } from "../router";
import { findRecord, recordReversal, reversalsOf, setLabDraft, useHistory } from "../store";

export function SourceBadge({ record }: { record: CalculationRecord }) {
  return record.source === "seed" ? (
    <Badge tone="neutral" title="Shipped with the demo so the app has history on first visit">
      Seeded demo
    </Badge>
  ) : (
    <Badge tone="accent" title="Recorded in this browser">
      Recorded here
    </Badge>
  );
}

function download(record: CalculationRecord) {
  const blob = new Blob([JSON.stringify(toJsonSafe(record), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${record.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Audit({ id }: { id: string }) {
  const history = useHistory();
  const record = history.find((r) => r.id === id);
  if (!record) {
    return (
      <>
        <PageHeader eyebrow="Audit" title="Calculation not found" />
        <Card>
          <p>
            No calculation with ID <Mono>{id}</Mono> in this browser's history. <a href={href("/history")}>Back to history</a>
          </p>
        </Card>
      </>
    );
  }
  return record.kind === "allocation" ? <AllocationAudit record={record} history={history} /> : <ReversalAudit record={record} />;
}

function AllocationAudit({ record, history }: { record: AllocationRecord; history: CalculationRecord[] }) {
  const { request, result } = record;
  const c = result.currency;
  const currency = getCurrency(c);
  const reversals = reversalsOf(history, record.id);

  // Reproducibility: re-run the stored inputs through the current engine and compare.
  const reproduced = useMemo(() => {
    const again = allocate(request);
    if (!again.ok) return { ok: false as const, reason: "stored inputs no longer validate" };
    const same =
      again.value.inputFingerprint === result.inputFingerprint &&
      again.value.lines.length === result.lines.length &&
      again.value.lines.every((l, i) => l.allocatedMinor === result.lines[i].allocatedMinor);
    return same ? { ok: true as const } : { ok: false as const, reason: `current engine ${again.value.engineVersion} produces a different result` };
  }, [request, result]);

  const rerun = () => {
    setLabDraft({ request: toWireRequest(request), label: `${record.label} (re-run)`, scenarioId: record.scenarioId });
    navigate("/lab");
  };

  return (
    <>
      <PageHeader
        eyebrow="Allocation audit"
        title={record.label}
        actions={
          <>
            <button type="button" className="secondary" onClick={() => download(record)}>
              Download JSON
            </button>
            <button type="button" className="secondary" onClick={rerun} title="Loads the inputs into the Lab. Changes create a new calculation; this record is never modified.">
              Re-run in Lab
            </button>
          </>
        }
      >
        <span className="mono">{record.id}</span> · {timestamp(record.createdAt)} · <SourceBadge record={record} /> <Badge tone="neutral">immutable</Badge>
      </PageHeader>

      <Card>
        <BalanceCheck
          currency={c}
          inputLabel="Input total"
          input={result.amountMinor}
          allocated={result.totals.allocatedMinor}
          unallocated={result.totals.unallocatedMinor}
        />
        <p className={reproduced.ok ? "repro ok" : "repro bad"}>
          {reproduced.ok
            ? `✓ Reproduced: re-running the stored inputs through engine ${result.engineVersion} gives the identical fingerprint and allocations.`
            : `✗ Not reproduced: ${reproduced.reason}.`}
        </p>
      </Card>

      <div className="two-col">
        <Card title="Calculation">
          <KeyValues
            items={[
              ["Allocation ID", <Mono key="id">{record.id}</Mono>],
              ["Created", timestamp(record.createdAt)],
              ["Strategy", `${result.strategy.name} (${result.strategy.id})`],
              ["Strategy version", result.strategy.version],
              ["Engine version", result.engineVersion],
              ["Currency", `${c} · ${currency.name} · ${currency.minorUnits} decimal places`],
              ["Input amount", money(result.amountMinor, c)],
              ["Input fingerprint", <Mono key="fp">{result.inputFingerprint}</Mono>],
              ["Rounding", "Largest remainder"],
              ["Residual distributed", `${money(result.rounding.residualMinor, c)} across ${count(result.rounding.adjustments.length)} line(s)`],
              ...(request.options?.proportionalBasis ? ([["Proportional basis", request.options.proportionalBasis]] as [string, string][]) : []),
            ]}
          />
        </Card>
        <Card title="Rules and constraints in effect">
          {result.appliedRules.length === 0 ? (
            <p className="muted">None beyond outstanding balances.</p>
          ) : (
            <ul className="rule-log">
              {result.appliedRules.map((r, i) => (
                <li key={i}>
                  <Mono>{r.obligationId}</Mono> <Badge tone={r.source === "request" ? "accent" : "neutral"}>{r.source === "request" ? "request rule" : "obligation"}</Badge> {r.description}
                  {r.label && <span className="muted"> ({r.label})</span>}
                </li>
              ))}
            </ul>
          )}
          {result.warnings.map((w) => (
            <p key={w} className="warning">
              {w}
            </p>
          ))}
        </Card>
      </div>

      <Card title={`Input obligations (${count(request.obligations.length)})`}>
        <div className="table-scroll">
          <table className="data compact">
            <thead>
              <tr>
                <th>ID</th>
                <th>Description</th>
                <th className="r">Original</th>
                <th className="r">Outstanding</th>
                <th className="r">Weight</th>
                <th className="r">Priority</th>
                <th>Due</th>
                <th className="r">Min</th>
                <th className="r">Max</th>
                <th className="r">Fixed</th>
                <th>Excluded</th>
              </tr>
            </thead>
            <tbody>
              {request.obligations.slice(0, 100).map((o) => (
                <tr key={o.id}>
                  <td className="mono">{o.id}</td>
                  <td>{o.description}</td>
                  <td className="r num">{o.originalMinor !== undefined ? money(o.originalMinor, c) : "—"}</td>
                  <td className="r num">{money(o.outstandingMinor, c)}</td>
                  <td className="r num">{o.weight ?? "—"}</td>
                  <td className="r num">{o.priority ?? "—"}</td>
                  <td>{o.dueDate ?? "—"}</td>
                  <td className="r num">{o.minMinor !== undefined ? money(o.minMinor, c) : "—"}</td>
                  <td className="r num">{o.maxMinor !== undefined ? money(o.maxMinor, c) : "—"}</td>
                  <td className="r num">{o.fixedMinor !== undefined ? money(o.fixedMinor, c) : "—"}</td>
                  <td>{o.excluded ? "yes" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {request.obligations.length > 100 && <p className="muted small">First 100 of {count(request.obligations.length)} shown; the JSON download contains all of them.</p>}
        </div>
      </Card>

      <Card title="Calculation steps">
        <Steps steps={result.steps} />
      </Card>

      <div className="two-col">
        <Card title="Rounding and residual distribution">
          <RoundingDetail rounding={result.rounding} currency={c} />
        </Card>
        <Card title="Invariants">
          <Invariants checks={result.invariants} />
        </Card>
      </div>

      <Card title="Final result">
        <AllocationTable result={result} />
      </Card>

      <Card title="Distribution">
        <DistributionTree result={result} sourceLabel="Input amount" />
      </Card>

      <ReversalPanel record={record} reversals={reversals} />
    </>
  );
}

function ReversalPanel({ record, reversals }: { record: AllocationRecord; reversals: ReversalRecord[] }) {
  const c = record.result.currency;
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<ReversalMethod>("proportional");
  const [reason, setReason] = useState("");
  const reversedSoFar = reversals.reduce((s, r) => s + r.result.totals.reversedMinor, 0n);
  const net = record.result.totals.allocatedMinor - reversedSoFar;

  const preview = useMemo(() => {
    if (amount.trim() === "") return null;
    const parsed = parseMoney(amount, c);
    if (!parsed.ok) return { ok: false as const, message: `Amount ${parsed.error}` };
    const prior = reversals.map((x) => x.result);
    const r = reverseAllocation({ request: record.request, result: record.result }, { amountMinor: parsed.value, method, reason: reason || undefined }, prior);
    return r.ok ? { ok: true as const, value: r.value, request: { amountMinor: parsed.value, method, reason: reason || undefined } } : { ok: false as const, message: r.errors.map((e) => e.message).join("; ") };
  }, [amount, method, reason, record, reversals, c]);

  const save = () => {
    if (!preview?.ok) return;
    const saved = recordReversal(record, preview.request, preview.value);
    navigate(`/history/${saved.id}`);
  };

  return (
    <Card title="Reversals">
      <p>
        A refund, chargeback or clawback never edits this record. It creates a <strong>reversal record</strong> that references this allocation and
        says how much each obligation gives back. {money(reversedSoFar, c)} has been reversed so far; {money(net, c)} is still allocated.
      </p>
      {reversals.length > 0 && (
        <ul className="linked">
          {reversals.map((r) => (
            <li key={r.id}>
              <a href={href(`/history/${r.id}`)} className="mono">
                {r.id}
              </a>{" "}
              · {timestamp(r.createdAt)} · {money(r.result.totals.reversedMinor, c)} ({REVERSAL_METHODS[r.result.method].name}) <SourceBadge record={r} />
            </li>
          ))}
        </ul>
      )}
      {net > 0n && (
        <>
          <div className="form-grid">
            <label className="field">
              <span>Reversal amount ({c})</span>
              <input inputMode="decimal" value={amount} placeholder={`up to ${money(net, c)}`} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="field">
              <span>Method</span>
              <select value={method} onChange={(e) => setMethod(e.target.value as ReversalMethod)}>
                {Object.entries(REVERSAL_METHODS).map(([id, m]) => (
                  <option key={id} value={id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field wide">
              <span>Reason</span>
              <input value={reason} placeholder="e.g. Partial refund: returned goods" onChange={(e) => setReason(e.target.value)} />
            </label>
          </div>
          <p className="muted small">{REVERSAL_METHODS[method].summary}</p>
        </>
      )}
      {preview && !preview.ok && <p className="error">{preview.message}</p>}
      {preview?.ok && (
        <>
          <ReversalLines record={{ result: preview.value }} />
          <div className="actions">
            <button type="button" onClick={save}>
              Record reversal
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

function ReversalLines({ record }: { record: Pick<ReversalRecord, "result"> }) {
  const r = record.result;
  const c = r.currency;
  const symbol = getCurrency(c).symbol;
  return (
    <div className="table-scroll">
      <table className="data">
        <thead>
          <tr>
            <th>Obligation</th>
            <th className="r">Originally allocated</th>
            <th className="r">Previously reversed</th>
            <th className="r">Raw</th>
            <th className="r">Adj.</th>
            <th className="r">Reversed</th>
            <th className="r">Net allocated</th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.obligationId} title={l.explanation.join("\n")}>
              <td>
                <span className="mono">{l.obligationId}</span>
                {l.description && <div className="sub">{l.description}</div>}
              </td>
              <td className="r num">{money(l.originallyAllocatedMinor, c)}</td>
              <td className="r num">{money(l.previouslyReversedMinor, c)}</td>
              <td className="r num raw">
                {symbol}
                {formatFraction(l.raw, c, 4)}
              </td>
              <td className="r num">{l.residualAdjustmentMinor > 0n ? <strong className="pos">{money(l.residualAdjustmentMinor, c, { signed: true })}</strong> : "—"}</td>
              <td className="r num strong neg">{money(-l.reversedMinor, c)}</td>
              <td className="r num">{money(l.netAllocatedMinor, c)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>Total</th>
            <th className="r num">{money(r.totals.originallyAllocatedMinor, c)}</th>
            <th className="r num">{money(r.totals.previouslyReversedMinor, c)}</th>
            <th />
            <th className="r num">{money(r.rounding.residualMinor, c)}</th>
            <th className="r num neg">{money(-r.totals.reversedMinor, c)}</th>
            <th className="r num">{money(r.totals.netAllocatedMinor, c)}</th>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ReversalAudit({ record }: { record: ReversalRecord }) {
  const r = record.result;
  const c = r.currency;
  const original = findRecord(record.reversesRecordId);
  return (
    <>
      <PageHeader
        eyebrow="Reversal audit"
        title={record.label}
        actions={
          <button type="button" className="secondary" onClick={() => download(record)}>
            Download JSON
          </button>
        }
      >
        <span className="mono">{record.id}</span> · {timestamp(record.createdAt)} · <SourceBadge record={record} /> <Badge tone="neutral">immutable</Badge>
      </PageHeader>
      <Card>
        <BalanceCheck currency={c} inputLabel="Reversal amount" outputLabel="Reversed" input={r.amountMinor} allocated={r.totals.reversedMinor} />
      </Card>
      <div className="two-col">
        <Card title="Reversal">
          <KeyValues
            items={[
              ["Reversal ID", <Mono key="id">{record.id}</Mono>],
              [
                "Reverses allocation",
                original ? (
                  <a key="o" href={href(`/history/${original.id}`)} className="mono">
                    {original.id}
                  </a>
                ) : (
                  <Mono key="o">{record.reversesRecordId}</Mono>
                ),
              ],
              ["Original fingerprint", <Mono key="fp">{r.reversesFingerprint}</Mono>],
              ["Method", `${REVERSAL_METHODS[r.method].name} v${r.methodVersion}`],
              ["Engine version", r.engineVersion],
              ["Reason", r.reason ?? "—"],
              ["Created", timestamp(record.createdAt)],
            ]}
          />
        </Card>
        <Card title="Invariants">
          <Invariants checks={r.invariants} />
        </Card>
      </div>
      <Card title="Reversal lines">
        <ReversalLines record={record} />
      </Card>
      <div className="two-col">
        <Card title="Calculation steps">
          <Steps steps={r.steps} />
        </Card>
        <Card title="Rounding and residual">
          <RoundingDetail rounding={r.rounding} currency={c} />
        </Card>
      </div>
    </>
  );
}
