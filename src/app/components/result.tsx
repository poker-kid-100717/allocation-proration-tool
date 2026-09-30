import { Fragment, useState } from "react";
import {
  formatFraction,
  formatPercent,
  getCurrency,
  type AllocationLine,
  type AllocationResult,
  type CalculationStep,
  type CurrencyCode,
  type InvariantCheck,
  type RoundingSummary,
} from "../../engine";
import { count, money } from "../format";
import { Badge } from "./ui";

/**
 * The balance check: amount in, amount out, and the difference, which must
 * be zero. It is the first thing on every result and audit screen.
 */
export function BalanceCheck({
  currency,
  inputLabel,
  outputLabel = "Allocated",
  input,
  allocated,
  unallocated = 0n,
  extra = [],
}: {
  currency: CurrencyCode;
  inputLabel: string;
  outputLabel?: string;
  input: bigint;
  allocated: bigint;
  unallocated?: bigint;
  extra?: [string, bigint][];
}) {
  const difference = input - allocated - unallocated;
  const balanced = difference === 0n;
  return (
    <div className={`balance ${balanced ? "balance-ok" : "balance-bad"}`} role="status" aria-label="Balance check">
      <div className="balance-cell">
        <span>{inputLabel}</span>
        <strong className="num">{money(input, currency)}</strong>
      </div>
      <div className="balance-op" aria-hidden>
        −
      </div>
      <div className="balance-cell">
        <span>{outputLabel}</span>
        <strong className="num">{money(allocated, currency)}</strong>
      </div>
      <div className="balance-op" aria-hidden>
        −
      </div>
      <div className="balance-cell">
        <span>Unallocated</span>
        <strong className="num">{money(unallocated, currency)}</strong>
      </div>
      <div className="balance-op" aria-hidden>
        =
      </div>
      <div className="balance-cell balance-diff">
        <span>Difference</span>
        <strong className="num">
          {money(difference, currency)} {balanced ? "✓" : "✗"}
        </strong>
      </div>
      {extra.map(([label, value]) => (
        <div className="balance-cell balance-extra" key={label}>
          <span>{label}</span>
          <strong className="num">{money(value, currency)}</strong>
        </div>
      ))}
    </div>
  );
}

const lineFlags = (l: AllocationLine) => (
  <>
    {l.excluded && <Badge tone="warn">excluded</Badge>}
    {l.fixedMinor > 0n && <Badge tone="accent">fixed</Badge>}
    {l.minimumMinor > 0n && <Badge tone="accent">minimum</Badge>}
    {l.capped && <Badge tone="warn">capped</Badge>}
    {l.residualAdjustmentMinor > 0n && <Badge tone="good">+residual</Badge>}
  </>
);

/** Result lines with share, raw, rounded and final amounts; click a row to see its explanation. */
export function AllocationTable({ result, limit = 100 }: { result: AllocationResult; limit?: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const [onlyAdjusted, setOnlyAdjusted] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const c = result.currency;
  const symbol = getCurrency(c).symbol;
  const filtered = onlyAdjusted ? result.lines.filter((l) => l.residualAdjustmentMinor > 0n || l.capped || l.excluded) : result.lines;
  const rows = showAll ? filtered : filtered.slice(0, limit);

  return (
    <div>
      <div className="table-toolbar">
        <label className="check">
          <input type="checkbox" checked={onlyAdjusted} onChange={(e) => setOnlyAdjusted(e.target.checked)} /> Only lines with rounding adjustments, caps or exclusions
        </label>
        <span className="muted">Select a row to see how its amount was derived.</span>
      </div>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Obligation</th>
              <th className="r">Outstanding</th>
              <th className="r">Share</th>
              <th className="r">Raw</th>
              <th className="r">Rounded</th>
              <th className="r">Adj.</th>
              <th className="r">Allocated</th>
              <th className="r">Remaining</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <Fragment key={l.obligationId}>
                <tr
                  className={`clickable ${open === l.obligationId ? "is-open" : ""}`}
                  onClick={() => setOpen(open === l.obligationId ? null : l.obligationId)}
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(open === l.obligationId ? null : l.obligationId))}
                  aria-expanded={open === l.obligationId}
                >
                  <td>
                    <span className="mono">{l.obligationId}</span>
                    {l.description && <div className="sub">{l.description}</div>}
                  </td>
                  <td className="r num">{money(l.outstandingMinor, c)}</td>
                  <td className="r num">{l.basisShare ? formatPercent(l.basisShare) : "—"}</td>
                  <td className="r num raw">
                    {symbol}
                    {formatFraction(l.raw, c, 4)}
                  </td>
                  <td className="r num">{money(l.baseMinor, c)}</td>
                  <td className="r num">{l.residualAdjustmentMinor > 0n ? <strong className="pos">{money(l.residualAdjustmentMinor, c, { signed: true })}</strong> : <span className="muted">—</span>}</td>
                  <td className="r num strong">{money(l.allocatedMinor, c)}</td>
                  <td className="r num">{money(l.remainingMinor, c)}</td>
                  <td className="flags">{lineFlags(l)}</td>
                </tr>
                {open === l.obligationId && (
                  <tr className="explain-row">
                    <td colSpan={9}>
                      <ol className="explain">
                        {l.explanation.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ol>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Total ({count(result.lines.length)})</th>
              <th className="r num">{money(result.totals.outstandingMinor, c)}</th>
              <th />
              <th />
              <th className="r num">{money(result.lines.reduce((s, l) => s + l.baseMinor, 0n), c)}</th>
              <th className="r num">{money(result.rounding.residualMinor, c, { signed: result.rounding.residualMinor > 0n })}</th>
              <th className="r num">{money(result.totals.allocatedMinor, c)}</th>
              <th className="r num">{money(result.totals.remainingOutstandingMinor, c)}</th>
              <th />
            </tr>
          </tfoot>
        </table>
      </div>
      {filtered.length > rows.length && (
        <button type="button" className="link" onClick={() => setShowAll(true)}>
          Show all {count(filtered.length)} lines (showing {count(rows.length)})
        </button>
      )}
    </div>
  );
}

/**
 * Where the money went, drawn as a tree from the source amount to each
 * recipient, with bar length proportional to amount.
 */
export function DistributionTree({ result, sourceLabel, max = 12 }: { result: AllocationResult; sourceLabel: string; max?: number }) {
  const c = result.currency;
  const sorted = [...result.lines].filter((l) => l.allocatedMinor > 0n).sort((a, b) => (a.allocatedMinor > b.allocatedMinor ? -1 : a.allocatedMinor < b.allocatedMinor ? 1 : 0));
  const shown = sorted.slice(0, max);
  const rest = sorted.slice(max);
  const restTotal = rest.reduce((s, l) => s + l.allocatedMinor, 0n);
  const zero = result.lines.length - sorted.length;
  const branches: { key: string; label: string; sub?: string; amount: bigint; tone?: string }[] = shown.map((l) => ({ key: l.obligationId, label: l.obligationId, sub: l.description, amount: l.allocatedMinor }));
  if (rest.length) branches.push({ key: "__rest", label: `${count(rest.length)} more recipients`, amount: restTotal, tone: "muted" });
  if (result.totals.unallocatedMinor > 0n) branches.push({ key: "__un", label: "Unallocated", sub: "no remaining capacity", amount: result.totals.unallocatedMinor, tone: "warn" });
  const pct = (m: bigint) => (result.amountMinor === 0n ? 0 : Number((m * 10000n) / result.amountMinor) / 100);

  return (
    <div className="tree">
      <div className="tree-root">
        <span>{sourceLabel}</span>
        <strong className="num">{money(result.amountMinor, c)}</strong>
      </div>
      <ul>
        {branches.map((b) => (
          <li key={b.key} className={b.tone ? `tree-${b.tone}` : ""}>
            <div className="tree-label">
              <span className="mono">{b.label}</span>
              {b.sub && <span className="sub">{b.sub}</span>}
            </div>
            <div className="tree-bar" aria-hidden>
              <div style={{ width: `${Math.max(pct(b.amount), 0.5)}%` }} />
            </div>
            <strong className="num tree-amount">{money(b.amount, c)}</strong>
          </li>
        ))}
      </ul>
      {zero > 0 && <p className="muted small">{plural0(zero)} received nothing.</p>}
    </div>
  );
}

const plural0 = (n: number) => (n === 1 ? "1 obligation" : `${count(n)} obligations`);

export function Steps({ steps }: { steps: readonly CalculationStep[] }) {
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={i}>
          <span className={`stage stage-${s.stage}`}>{s.stage}</span>
          <span>{s.message}</span>
        </li>
      ))}
    </ol>
  );
}

export function Invariants({ checks }: { checks: readonly InvariantCheck[] }) {
  return (
    <ul className="invariants">
      {checks.map((c) => (
        <li key={c.name} className={c.holds ? "ok" : "bad"}>
          <span aria-hidden>{c.holds ? "✓" : "✗"}</span>
          <div>
            <strong>{c.name}</strong>
            <div className="sub">{c.detail}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RoundingDetail({ rounding, currency }: { rounding: RoundingSummary; currency: CurrencyCode }) {
  const symbol = getCurrency(currency).symbol;
  return (
    <div>
      <p>
        Method: <strong>largest remainder</strong>. Every exact share is floored to a whole minor unit (
        {money(1n, currency)}); the residual of <strong className="num">{money(rounding.residualMinor, currency)}</strong> is then handed out one unit at a time, ordered by{" "}
        {rounding.tieBreak.join(", ")}.
      </p>
      {rounding.adjustments.length === 0 ? (
        <p className="muted">No residual: every share was already a whole number of minor units.</p>
      ) : (
        <div className="table-scroll">
          <table className="data compact">
            <thead>
              <tr>
                <th className="r">Rank</th>
                <th>Obligation</th>
                <th className="r">Fractional remainder</th>
                <th className="r">Adjustment</th>
              </tr>
            </thead>
            <tbody>
              {rounding.adjustments.slice(0, 50).map((a) => (
                <tr key={a.obligationId}>
                  <td className="r num">{a.rank}</td>
                  <td className="mono">{a.obligationId}</td>
                  <td className="r num">
                    {symbol}
                    {formatFraction(a.remainder, currency, 4)}
                  </td>
                  <td className="r num pos">{money(a.adjustmentMinor, currency, { signed: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rounding.adjustments.length > 50 && <p className="muted small">… and {count(rounding.adjustments.length - 50)} more adjustments.</p>}
        </div>
      )}
    </div>
  );
}
