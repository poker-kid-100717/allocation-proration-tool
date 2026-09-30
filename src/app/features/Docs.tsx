import { ENGINE_VERSION, REVERSAL_METHODS, RESIDUAL_TIE_BREAK, STRATEGY_LIST, SUPPORTED_CURRENCIES } from "../../engine";
import { Card, PageHeader } from "../components/ui";

const REPO = "https://github.com/poker-kid-100717/allocation-proration-tool";

const curl = (origin: string) => `curl -s ${origin}/api/allocate \\
  -H 'content-type: application/json' \\
  -d '{
    "amount": "7500.00",
    "currency": "USD",
    "strategy": "proportional",
    "obligations": [
      { "id": "INV-101", "outstanding": "4200.00" },
      { "id": "INV-102", "outstanding": "2800.00" },
      { "id": "INV-103", "outstanding": "3000.00" }
    ]
  }'`;

const RESPONSE = `{
  "summary": {
    "currency": "USD", "amount": "7500.00", "allocated": "7500.00",
    "unallocated": "0.00", "difference": "0.00",
    "allocations": { "INV-101": "3150.00", "INV-102": "2100.00", "INV-103": "2250.00" }
  },
  "result": { "inputFingerprint": "…", "lines": [ … ], "rounding": { … }, "invariants": [ … ] }
}`;

export function Docs() {
  return (
    <>
      <PageHeader eyebrow="Documentation" title="How Prorata works">
        Engine version {ENGINE_VERSION}. Full write-up, architecture diagram and test inventory are in the{" "}
        <a href={REPO} target="_blank" rel="noreferrer">
          README on GitHub
        </a>
        .
      </PageHeader>

      <div className="docs">
        <Card title="Scope">
          <p>
            Prorata answers one question: <strong>how should this amount be distributed?</strong> It takes an amount and a set of obligations and returns
            an exact, explained, reproducible split. It doesn't move money, post ledger entries, reconcile transactions or trace payments after the
            fact; those belong to the systems that call it.
          </p>
        </Card>

        <Card title="Money representation">
          <p>
            Every amount is an integer number of the currency's minor unit, held as a <code>bigint</code>. There is no floating point anywhere on the
            calculation path, and no 2<sup>53</sup> ceiling. Unrounded shares are exact fractions (<code>num/den</code>), which is how the audit can show
            $33.333333… without ever holding it as a float.
          </p>
          <p>
            Input and output amounts are decimal strings. The parser rejects more decimal places than the currency has, rather than rounding user input.
            Supported precisions:{" "}
            {SUPPORTED_CURRENCIES.map((c) => `${c.code} (${c.minorUnits})`).join(", ")}.
          </p>
        </Card>

        <Card title="Strategies">
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Version</th>
                  <th>What it does</th>
                  <th>Residual handling</th>
                </tr>
              </thead>
              <tbody>
                {STRATEGY_LIST.map((s) => (
                  <tr key={s.id}>
                    <td className="nowrap">
                      <strong>{s.name}</strong>
                      <div className="sub mono">{s.id}</div>
                    </td>
                    <td className="num">{s.version}</td>
                    <td>{s.summary}</td>
                    <td className="muted">{s.residualHandling}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Strategies implement one interface and receive only the pool left after fixed amounts and minimums. Validation, rules, caps, invariants and
            the audit trail belong to the engine, so a new strategy can't bypass them.
          </p>
        </Card>

        <Card title="Rounding: largest remainder">
          <ol>
            <li>Compute each share exactly: pool × weight ÷ total weight, as a fraction of minor units.</li>
            <li>Floor every share to a whole minor unit.</li>
            <li>The residual (pool minus the floored sum) is always fewer units than there are recipients.</li>
            <li>Give one unit each to the recipients with the largest fractional remainders.</li>
          </ol>
          <p>
            Tie-break, in order: {RESIDUAL_TIE_BREAK.join("; ")}. ID comparison is by UTF-16 code unit, not <code>localeCompare</code>, so it is the same
            in every browser, Node version and Worker.
          </p>
          <p>
            Why this method: it minimises the largest deviation from the exact share (no line is ever off by a full minor unit), it is standard for
            apportionment, and its outcome is easy to explain line by line. Alternatives like "put the residual on the largest line" or "on the first
            line" are simpler, but they bias one party systematically.
          </p>
        </Card>

        <Card title="Caps and redistribution">
          <p>
            A share that meets or exceeds its cap (outstanding balance or maximum) is set to exactly the cap, and the surplus is re-split among the
            remaining participants, round after round, until nobody exceeds a cap. Participants are visited in ascending cap-to-weight order, which makes
            this O(n log n) rather than O(n²). If every participant is capped, the leftover is reported as <em>unallocated</em>, never silently created or
            dropped.
          </p>
        </Card>

        <Card title="Determinism and versioning">
          <ul>
            <li>Same inputs, rules and strategy version always give a deep-equal result, including explanations and the input fingerprint.</li>
            <li>Results don't depend on obligation order, hash-map iteration, locale, clock or platform. Order independence is a tested property.</li>
            <li>Every record stores the engine version and strategy version. A change that could alter any output requires a version bump.</li>
            <li>The input fingerprint is a 64-bit FNV-1a hash of the canonical request. It identifies identical calculations; it is not a security control.</li>
          </ul>
        </Card>

        <Card title="Invariants checked on every result">
          <ul>
            <li>Conservation: allocated + unallocated = amount, exactly.</li>
            <li>Full application: money is left unallocated only when every eligible obligation is at capacity.</li>
            <li>0 ≤ allocation ≤ min(outstanding, maximum) for every line.</li>
            <li>Fixed amounts, minimums and exclusions are honoured.</li>
            <li>Every allocation is within one minor unit of its exact share.</li>
          </ul>
        </Card>

        <Card title="Reversals">
          <p>A refund creates a new reversal calculation that references the original by fingerprint. The original record is never modified.</p>
          <ul>
            {Object.entries(REVERSAL_METHODS).map(([id, m]) => (
              <li key={id}>
                <strong>{m.name}</strong>: {m.summary}
              </li>
            ))}
          </ul>
          <p>Prior reversals are taken into account, so a series of partial refunds can never give back more than a line received.</p>
        </Card>

        <Card title="HTTP API">
          <p>
            The same engine runs in the Cloudflare Worker that serves this page. Endpoints: <code>POST /api/allocate</code>, <code>POST /api/reverse</code>{" "}
            (stateless: send the original request and the refund amount), <code>GET /api/meta</code> and <code>GET /api/health</code>. Money must be sent as
            decimal strings; JSON numbers are rejected. Invalid input returns <code>422</code> with every issue and its path.
          </p>
          <pre className="code">{curl(window.location.origin)}</pre>
          <pre className="code">{RESPONSE}</pre>
        </Card>
      </div>
    </>
  );
}
