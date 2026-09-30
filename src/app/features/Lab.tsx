import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  allocate,
  getCurrency,
  parseWireRequest,
  STRATEGIES,
  STRATEGY_LIST,
  SUPPORTED_CURRENCIES,
  type AllocationRequest,
  type AllocationResult,
  type RuleKind,
  type ValidationIssue,
  type WireAllocationRequest,
  type WireObligation,
  type WireRule,
} from "../../engine";
import { buildScenarioRequest, getScenario } from "../../scenarios/catalog";
import { AllocationTable, BalanceCheck, DistributionTree, Invariants, RoundingDetail, Steps } from "../components/result";
import { Badge, Card, PageHeader } from "../components/ui";
import { count, money } from "../format";
import { navigate, type Route } from "../router";
import { getLabDraft, recordAllocation, setLabDraft, updateLabDraft, type LabDraft } from "../store";

/** Above this many obligations the editor switches to a read-only preview. */
const EDITABLE_LIMIT = 200;

export function loadScenarioIntoLab(scenarioId: string, variantId?: string) {
  const scenario = getScenario(scenarioId);
  const request = buildScenarioRequest(scenarioId, variantId);
  if (!scenario || !request) return;
  const variant = scenario.variants.find((v) => v.id === variantId);
  setLabDraft({ request, label: variant ? `${scenario.title}: ${variant.label}` : scenario.title, scenarioId });
  navigate(`/lab`);
}

const initialDraft = (): LabDraft => {
  const existing = getLabDraft();
  if (existing) return existing;
  setLabDraft({ request: buildScenarioRequest("partial-invoice-payment")!, label: "Partial invoice payment", scenarioId: "partial-invoice-payment" });
  return getLabDraft()!;
};

type Computation = { ok: true; request: AllocationRequest; result: AllocationResult } | { ok: false; errors: ValidationIssue[] };

function compute(wire: WireAllocationRequest): Computation {
  const parsed = parseWireRequest(wire);
  if (!parsed.ok) return parsed;
  const result = allocate(parsed.value);
  if (!result.ok) return result;
  return { ok: true, request: parsed.value, result: result.value };
}

export function Lab({ route }: { route: Route }) {
  const [draft, setDraft] = useState<LabDraft>(initialDraft);

  // Deep links: #/lab?scenario=credit-allocation&variant=proportional
  const linkedScenario = route.query.get("scenario");
  const linkedVariant = route.query.get("variant") ?? undefined;
  useEffect(() => {
    if (linkedScenario) loadScenarioIntoLab(linkedScenario, linkedVariant);
  }, [linkedScenario, linkedVariant]);

  // Pick up drafts loaded from other screens (scenarios, history re-runs).
  const external = getLabDraft();
  if (external && external.revision !== draft.revision) setDraft(external);

  const update = (next: Partial<LabDraft> & { request?: WireAllocationRequest }) => {
    const merged = { ...draft, ...next };
    updateLabDraft(merged);
    setDraft(merged);
  };
  const setRequest = (patch: Partial<WireAllocationRequest>) => update({ request: { ...draft.request, ...patch } });

  const deferred = useDeferredValue(draft.request);
  const computation = useMemo(() => compute(deferred), [deferred]);
  const stale = deferred !== draft.request;

  const { request } = draft;
  const scenario = draft.scenarioId ? getScenario(draft.scenarioId) : undefined;
  const strategy = STRATEGIES[request.strategy as keyof typeof STRATEGIES];
  const currency = SUPPORTED_CURRENCIES.find((c) => c.code === request.currency);

  const record = () => {
    if (!computation.ok) return;
    const saved = recordAllocation(computation.request, computation.result, draft.label || "Untitled allocation", draft.scenarioId);
    navigate(`/history/${saved.id}`);
  };

  return (
    <>
      <PageHeader
        eyebrow="Allocation Lab"
        title={draft.label || "Untitled allocation"}
      >
        Enter an amount and the obligations it should be applied to. The result recalculates as you type. Nothing is saved until you record it,
        and recorded calculations can't be edited afterwards.
      </PageHeader>

      {scenario && (
        <div className="scenario-bar">
          <span className="muted">Scenario:</span> <strong>{scenario.title}</strong>
          {scenario.variants.length > 0 && (
            <div className="chips" role="group" aria-label="Scenario variants">
              {scenario.variants.map((v) => (
                <button key={v.id} type="button" className="chip" title={v.note} onClick={() => loadScenarioIntoLab(scenario.id, v.id)}>
                  {v.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="lab-grid">
        <Card title="Amount and method">
          <div className="form-grid">
            <label className="field">
              <span>Amount to allocate</span>
              <div className="money-input">
                <span>{currency?.symbol.trim()}</span>
                <input inputMode="decimal" value={request.amount} onChange={(e) => setRequest({ amount: e.target.value })} aria-label="Amount to allocate" />
              </div>
            </label>
            <label className="field">
              <span>Currency</span>
              <select value={request.currency} onChange={(e) => setRequest({ currency: e.target.value })}>
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}: {c.name} ({c.minorUnits} dp)
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Allocation strategy</span>
              <select value={request.strategy} onChange={(e) => setRequest({ strategy: e.target.value })}>
                {STRATEGY_LIST.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {request.strategy === "proportional" && (
              <label className="field">
                <span>Proportional basis</span>
                <select value={request.options?.proportionalBasis ?? "outstanding"} onChange={(e) => setRequest({ options: { proportionalBasis: e.target.value as "outstanding" | "original" } })}>
                  <option value="outstanding">Outstanding balance</option>
                  <option value="original">Original amount</option>
                </select>
              </label>
            )}
            <label className="field wide">
              <span>Label for the record</span>
              <input value={draft.label} onChange={(e) => update({ label: e.target.value })} />
            </label>
          </div>
          {strategy && (
            <p className="strategy-note">
              <strong>
                {strategy.name} v{strategy.version}.
              </strong>{" "}
              {strategy.summary} <span className="muted">Rounding: {strategy.residualHandling}</span>
            </p>
          )}
        </Card>

        <ObligationsEditor request={request} onChange={(obligations) => setRequest({ obligations })} />
        <RulesEditor request={request} onChange={(rules) => setRequest({ rules })} />
      </div>

      <div className={stale ? "is-stale" : ""} aria-busy={stale}>
        {computation.ok ? (
          <ResultPanel computation={computation} onRecord={record} />
        ) : (
          <Card title="Can't allocate yet" className="card-error">
            <p>Fix these inputs and the result will appear. Nothing is rounded, guessed or silently corrected.</p>
            <ul className="issues">
              {computation.errors.map((e, i) => (
                <li key={i}>
                  {e.path && <code className="mono">{e.path}</code>} {e.message}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

function ResultPanel({ computation, onRecord }: { computation: Extract<Computation, { ok: true }>; onRecord: () => void }) {
  const { result } = computation;
  const c = result.currency;
  return (
    <>
      <Card
        title="Result"
        actions={
          <button type="button" onClick={onRecord}>
            Record calculation
          </button>
        }
      >
        <BalanceCheck
          currency={c}
          inputLabel="Amount"
          input={result.amountMinor}
          allocated={result.totals.allocatedMinor}
          unallocated={result.totals.unallocatedMinor}
          extra={[
            ["Obligations outstanding", result.totals.outstandingMinor],
            ["Remaining after allocation", result.totals.remainingOutstandingMinor],
          ]}
        />
        <p className="summary-line">
          {result.strategy.name} v{result.strategy.version} · {count(result.lines.length)} obligations · residual {money(result.rounding.residualMinor, c)} across{" "}
          {count(result.rounding.adjustments.length)} line(s) · input fingerprint <code className="mono">{result.inputFingerprint}</code>
        </p>
        {result.warnings.map((w) => (
          <p key={w} className="warning">
            {w}
          </p>
        ))}
        <AllocationTable result={result} />
      </Card>

      <div className="two-col">
        <Card title="Distribution">
          <DistributionTree result={result} sourceLabel="Amount to allocate" />
        </Card>
        <Card title="Invariants">
          <Invariants checks={result.invariants} />
        </Card>
      </div>
      <div className="two-col">
        <Card title="Calculation steps">
          <Steps steps={result.steps} />
        </Card>
        <Card title="Rounding and residual">
          <RoundingDetail rounding={result.rounding} currency={c} />
        </Card>
      </div>
    </>
  );
}

let rowKey = 0;
const keyed = new WeakMap<WireObligation, number>();
const keyOf = (o: WireObligation) => {
  let k = keyed.get(o);
  if (k === undefined) keyed.set(o, (k = rowKey++));
  return k;
};

type ObligationField = Exclude<keyof WireObligation, "excluded">;
const COLUMNS: { field: ObligationField; label: string; width?: string; hint?: string; placeholder?: string }[] = [
  { field: "id", label: "ID", width: "8.5rem" },
  { field: "description", label: "Description", width: "10rem" },
  { field: "outstanding", label: "Outstanding", width: "7.5rem" },
  { field: "original", label: "Original", width: "7rem" },
  { field: "weight", label: "Weight", width: "4.5rem", placeholder: "—" },
  { field: "priority", label: "Priority", width: "4.5rem", placeholder: "—" },
  { field: "dueDate", label: "Due date", width: "7.5rem", placeholder: "YYYY-MM-DD" },
  { field: "min", label: "Min", width: "6rem", placeholder: "—" },
  { field: "max", label: "Max", width: "6rem", placeholder: "—" },
  { field: "fixed", label: "Fixed", width: "6rem", placeholder: "—" },
];

function ObligationsEditor({ request, onChange }: { request: WireAllocationRequest; onChange: (o: WireObligation[]) => void }) {
  const rows = request.obligations;
  const set = (i: number, patch: Partial<WireObligation>) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    // Keep the React key stable for an edited row.
    keyed.set(next[i], keyOf(rows[i]));
    onChange(next);
  };
  const add = () => onChange([...rows, { id: nextId(rows), outstanding: "0.00" }]);
  const currencyDp = getCurrencySafe(request.currency);

  if (rows.length > EDITABLE_LIMIT) {
    return (
      <Card title={`Obligations (${count(rows.length)})`}>
        <p>
          This is a generated set of {count(rows.length)} obligations. The editor is read-only above {EDITABLE_LIMIT} rows, but every row is still
          calculated in full below. The first 8 are shown here.
        </p>
        <div className="table-scroll">
          <table className="data compact">
            <thead>
              <tr>
                <th>ID</th>
                <th>Description</th>
                <th className="r">Outstanding</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map((o) => (
                <tr key={o.id}>
                  <td className="mono">{o.id}</td>
                  <td>{o.description}</td>
                  <td className="r num">{o.outstanding}</td>
                  <td>{o.dueDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={`Obligations (${count(rows.length)})`}
      actions={
        <button type="button" className="secondary" onClick={add}>
          Add obligation
        </button>
      }
    >
      <p className="muted small">
        Amounts are decimal strings in {request.currency} ({currencyDp} decimal places). Weight, priority, min, max and fixed are optional; the
        allocation never exceeds outstanding or max.
      </p>
      <div className="table-scroll">
        <table className="data editor">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.field} style={{ minWidth: c.width }}>
                  {c.label}
                </th>
              ))}
              <th title="Exclude from this allocation">Excl.</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {rows.map((o, i) => (
              <tr key={keyOf(o)}>
                {COLUMNS.map((c) => (
                  <td key={c.field}>
                    <input
                      value={o[c.field] === undefined ? "" : String(o[c.field])}
                      placeholder={c.placeholder}
                      aria-label={`${c.label} for row ${i + 1}`}
                      inputMode={["outstanding", "original", "min", "max", "fixed", "weight", "priority"].includes(c.field) ? "decimal" : undefined}
                      className={["outstanding", "original", "min", "max", "fixed", "weight", "priority"].includes(c.field) ? "num r" : c.field === "id" ? "mono" : ""}
                      onChange={(e) => set(i, { [c.field]: e.target.value === "" && c.field !== "id" && c.field !== "outstanding" ? undefined : e.target.value })}
                    />
                  </td>
                ))}
                <td className="c">
                  <input type="checkbox" checked={o.excluded === true} onChange={(e) => set(i, { excluded: e.target.checked || undefined })} aria-label={`Exclude ${o.id}`} />
                </td>
                <td>
                  <button type="button" className="ghost" onClick={() => onChange(rows.filter((_, j) => j !== i))} disabled={rows.length === 1} aria-label={`Remove ${o.id || "row"}`}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const getCurrencySafe = (code: string) => SUPPORTED_CURRENCIES.find((c) => c.code === code)?.minorUnits ?? getCurrency("USD").minorUnits;

function nextId(rows: WireObligation[]) {
  const ids = new Set(rows.map((r) => r.id));
  for (let i = rows.length + 1; ; i++) {
    const id = `OBL-${String(i).padStart(3, "0")}`;
    if (!ids.has(id)) return id;
  }
}

const RULE_KINDS: { kind: RuleKind; label: string; value?: "amount" | "priority" | "weight" }[] = [
  { kind: "cap", label: "Cap at", value: "amount" },
  { kind: "minimum", label: "Minimum of", value: "amount" },
  { kind: "fixed", label: "Fixed amount", value: "amount" },
  { kind: "exclude", label: "Exclude" },
  { kind: "priority", label: "Priority", value: "priority" },
  { kind: "weight", label: "Weight / %", value: "weight" },
];

function RulesEditor({ request, onChange }: { request: WireAllocationRequest; onChange: (r: WireRule[] | undefined) => void }) {
  const rules = request.rules ?? [];
  const ids = request.obligations.slice(0, EDITABLE_LIMIT).map((o) => o.id);
  const set = (i: number, patch: Partial<WireRule>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => {
    const next = rules.filter((_, j) => j !== i);
    onChange(next.length ? next : undefined);
  };

  return (
    <Card
      title={
        <>
          Rules <Badge>{rules.length}</Badge>
        </>
      }
      actions={
        <button type="button" className="secondary" onClick={() => onChange([...rules, { kind: "cap", obligationId: ids[0] ?? "", amount: "" }])} disabled={ids.length === 0}>
          Add rule
        </button>
      }
    >
      <p className="muted small">
        Request-level rules layered on top of the obligations: caps take the lowest value, minimums the highest, and priority/weight rules replace
        the obligation's own value. <a href="#/rules">How rules combine</a>
      </p>
      {rules.length === 0 ? (
        <p className="muted">No rules. Every obligation is limited only by its own balance and constraints.</p>
      ) : (
        <ul className="rules-list">
          {rules.map((r, i) => {
            const meta = RULE_KINDS.find((k) => k.kind === r.kind);
            return (
              <li key={i}>
                <select value={r.kind} onChange={(e) => set(i, { kind: e.target.value as RuleKind })} aria-label="Rule kind">
                  {RULE_KINDS.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <select value={r.obligationId} onChange={(e) => set(i, { obligationId: e.target.value })} aria-label="Obligation">
                  {!ids.includes(r.obligationId) && <option value={r.obligationId}>{r.obligationId || "(choose)"}</option>}
                  {ids.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
                {meta?.value && (
                  <input
                    className="num r"
                    value={String(r[meta.value] ?? "")}
                    placeholder={meta.value}
                    onChange={(e) => set(i, { [meta.value!]: e.target.value })}
                    aria-label={meta.value}
                  />
                )}
                <input value={r.label ?? ""} placeholder="Reason (optional)" onChange={(e) => set(i, { label: e.target.value || undefined })} aria-label="Rule reason" />
                <button type="button" className="ghost" onClick={() => remove(i)} aria-label="Remove rule">
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
